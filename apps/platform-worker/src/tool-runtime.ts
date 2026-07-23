import type { AutonomyLevel, ToolPolicy } from "@workrr/contracts";
import { jsonSchema, tool, type ToolSet } from "ai";
import { invokeBoundAdapter, isBoundAdapter } from "./tool-adapters";
import { applyDlp, DlpBlockedError } from "./dlp";
import type { Env } from "./types";

export interface ToolRuntimeContext {
  tenantId: string;
  executionId: string;
  autonomy: AutonomyLevel;
  policies: ToolPolicy[];
}

export interface ToolInvocationEvidence {
  id: string;
  toolName: string;
  status: "simulated" | "proposed" | "completed" | "failed" | "denied";
  executionMode: "simulation" | "proposal_only" | "bound";
  approvalRequired: boolean;
}

export function buildExecutionTools(env: Env, context?: ToolRuntimeContext): {
  tools?: ToolSet;
  evidence: ToolInvocationEvidence[];
} {
  const evidence: ToolInvocationEvidence[] = [];
  if (!context || !["approve", "guarded", "autonomous"].includes(context.autonomy)) return { evidence };
  const tools: ToolSet = {};
  for (const policy of context.policies.slice(0, 20)) {
    const mode = toolExecutionMode(policy, context.autonomy);
    tools[policy.name] = tool({
      description: `${policy.description ?? policy.name}. Access: ${policy.accessMode}. Risk: ${policy.riskLevel}. ${
        mode === "simulation" ? "This returns simulated data and contacts no external system." :
        "This creates a governed proposal only; no external action is performed."
      }`,
      inputSchema: jsonSchema(parseSchema(policy.inputSchemaJson)),
      execute: async (input, options) => {
        const toolCallId = options.toolCallId;
        const protectedInput = await applyDlp(env, context.tenantId, safeJson(input), {
          direction: "output", stage: "tool_input", executionId: context.executionId
        });
        const inputJson = protectedInput.safeText;
        const adapterInput = parseEvidence(protectedInput.modelText);
        const idempotencyKey = await invocationKey(context.executionId, policy, protectedInput.modelText);
        const id = `tool-inv-${idempotencyKey}`;
        const approvalRequired = mode === "proposal_only";
        let status: ToolInvocationEvidence["status"] = approvalRequired ? "proposed" :
          mode === "simulation" ? "simulated" : "completed";
        if (protectedInput.blocked) {
          status = "denied";
          await recordInvocation(env, context, policy, {
            id, toolCallId, idempotencyKey, inputJson, outputJson: null, mode, status,
            error: `DLP blocked tool input containing: ${protectedInput.blockedDetectors.join(", ")}`
          });
          evidence.push({ id, toolName: policy.name, status, executionMode: mode, approvalRequired: false });
          throw new DlpBlockedError(protectedInput.blockedDetectors);
        }
        const existing = await env.DB.prepare(`SELECT status, execution_mode, output_json, error
          FROM tool_invocations WHERE tenant_id=? AND idempotency_key=?`)
          .bind(context.tenantId, idempotencyKey).first<{
            status: ToolInvocationEvidence["status"]; execution_mode: ToolInvocationEvidence["executionMode"];
            output_json: string | null; error: string | null;
          }>();
        if (existing && existing.status !== "failed") {
          evidence.push({ id, toolName: policy.name, status: existing.status,
            executionMode: existing.execution_mode, approvalRequired: existing.status === "proposed" });
          if (existing.status === "denied") {
            throw new Error(existing.error || `Prior ${policy.name} invocation did not complete`);
          }
          return parseEvidence(existing.output_json);
        }
        try {
          if (mode === "bound") await assertWithinRateLimit(env, context.tenantId, policy);
          const bound = mode === "bound"
            ? await invokeBoundAdapter(env, context.tenantId, context.executionId, policy, adapterInput)
            : null;
          const output = approvalRequired
            ? { status: "approval_required", tool: policy.name, message: "No external action was performed." }
            : mode === "simulation"
              ? { status: "simulated", tool: policy.name, input: adapterInput, message: "Simulation only; no external system was contacted." }
              : bound!.modelOutput;
          await recordInvocation(env, context, policy, {
            id, toolCallId, idempotencyKey, inputJson,
            outputJson: safeJson(bound?.evidenceOutput ?? output), mode, status
          });
          evidence.push({ id, toolName: policy.name, status, executionMode: mode, approvalRequired });
          return output;
        } catch (error) {
          status = error instanceof Error && error.message.includes("rate limit") ? "denied" : "failed";
          await recordInvocation(env, context, policy, {
            id, toolCallId, idempotencyKey, inputJson, outputJson: null, mode, status,
            error: error instanceof Error ? error.message : String(error)
          });
          evidence.push({ id, toolName: policy.name, status, executionMode: mode, approvalRequired: false });
          throw error;
        }
      }
    });
  }
  return Object.keys(tools).length ? { tools, evidence } : { evidence };
}

export function toolExecutionMode(policy: ToolPolicy, autonomy: AutonomyLevel = "guarded"):
  "simulation" | "proposal_only" | "bound" {
  if (autonomy !== "approve" && policy.adapterKind === "microsoft" && isBoundAdapter(policy.handlerKey) &&
    policy.accessMode === "read" && policy.riskLevel === "low" && policy.connectionReady) return "bound";
  if (policy.adapterKind === "mock" && policy.accessMode === "read" &&
    policy.riskLevel === "low" && policy.connectionReady) return "simulation";
  return "proposal_only";
}

function parseSchema(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && parsed.type === "object" ? parsed : { type: "object", additionalProperties: true };
  } catch {
    return { type: "object", additionalProperties: true };
  }
}

function safeJson(value: unknown): string {
  const serialized = JSON.stringify(value ?? {});
  return serialized.length <= 8000 ? serialized : JSON.stringify({ truncated: true, preview: serialized.slice(0, 7900) });
}

async function invocationKey(executionId: string, policy: ToolPolicy, inputJson: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${executionId}:${policy.id}:${policy.version}:${inputJson}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertWithinRateLimit(env: Env, tenantId: string, policy: ToolPolicy) {
  const result = await env.DB.prepare(`SELECT COUNT(*) count FROM tool_invocations
    WHERE tenant_id=? AND tool_id=? AND datetime(started_at) >= datetime('now','-1 minute')`)
    .bind(tenantId, policy.id).first<{ count: number }>();
  if (Number(result?.count ?? 0) >= policy.rateLimitPerMinute) {
    throw new Error(`Tool rate limit exceeded for ${policy.name}`);
  }
}

async function recordInvocation(env: Env, context: ToolRuntimeContext, policy: ToolPolicy, value: {
  id: string; toolCallId: string; idempotencyKey: string; inputJson: string; outputJson: string | null;
  mode: ToolInvocationEvidence["executionMode"]; status: ToolInvocationEvidence["status"]; error?: string;
}) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO tool_invocations
    (id, tenant_id, execution_id, tool_id, tool_name, tool_version, tool_call_id, status,
     execution_mode, access_mode, risk_level, adapter_kind, handler_key, input_json, output_json, error,
     idempotency_key, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, idempotency_key) DO UPDATE SET
      tool_call_id=excluded.tool_call_id, status=excluded.status, output_json=excluded.output_json,
      error=excluded.error, started_at=excluded.started_at, completed_at=excluded.completed_at`)
    .bind(value.id, context.tenantId, context.executionId, policy.id, policy.name, policy.version,
      value.toolCallId, value.status, value.mode, policy.accessMode, policy.riskLevel, policy.adapterKind,
      policy.handlerKey ?? null, value.inputJson, value.outputJson, value.error?.slice(0, 500) ?? null,
      value.idempotencyKey, now, now).run();
}

function parseEvidence(value: string | null) {
  if (!value) return { status: "completed" };
  try { return JSON.parse(value) as unknown; }
  catch { return { status: "completed", evidence: value }; }
}
