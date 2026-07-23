import type { AutonomyLevel, ToolPolicy } from "@workrr/contracts";
import { jsonSchema, tool, type ToolSet } from "ai";
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
    const mode = toolExecutionMode(policy);
    tools[policy.name] = tool({
      description: `${policy.description ?? policy.name}. Access: ${policy.accessMode}. Risk: ${policy.riskLevel}. ${
        mode === "simulation" ? "This returns simulated data and contacts no external system." :
        "This creates a governed proposal only; no external action is performed."
      }`,
      inputSchema: jsonSchema(parseSchema(policy.inputSchemaJson)),
      execute: async (input, options) => {
        const toolCallId = options.toolCallId;
        const inputJson = safeJson(input);
        const idempotencyKey = await invocationKey(context.executionId, policy, inputJson);
        const id = `tool-inv-${idempotencyKey}`;
        const approvalRequired = mode !== "simulation";
        const status = approvalRequired ? "proposed" : "simulated";
        const output = approvalRequired
          ? { status: "approval_required", tool: policy.name, message: "No external action was performed." }
          : { status: "simulated", tool: policy.name, input, message: "Simulation only; no external system was contacted." };
        await env.DB.prepare(`INSERT OR IGNORE INTO tool_invocations
          (id, tenant_id, execution_id, tool_id, tool_name, tool_version, tool_call_id, status,
           execution_mode, access_mode, risk_level, adapter_kind, input_json, output_json,
           idempotency_key, started_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, context.tenantId, context.executionId, policy.id, policy.name, policy.version,
            toolCallId, status, mode, policy.accessMode, policy.riskLevel, policy.adapterKind,
            inputJson, safeJson(output), idempotencyKey,
            new Date().toISOString(), new Date().toISOString()).run();
        evidence.push({ id, toolName: policy.name, status, executionMode: mode, approvalRequired });
        return output;
      }
    });
  }
  return Object.keys(tools).length ? { tools, evidence } : { evidence };
}

export function toolExecutionMode(policy: ToolPolicy): "simulation" | "proposal_only" | "bound" {
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
