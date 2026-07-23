import { getAgentByName } from "agents";
import { instanceKeyFor, type ExecutionRequest, type ExecutionResult, type PromptBundle } from "@workrr/contracts";
import { runModel } from "./model";
import { getBlueprint, getPromptBundle } from "./repository";
import type { ProcessAgent } from "./agent";
import type { Env } from "./types";
import { assertBudgetAvailable, pricedCompletionSql } from "./usage";

export async function executeRequest(env: Env, tenantId: string, request: ExecutionRequest, executionId: string = crypto.randomUUID()): Promise<ExecutionResult> {
  const blueprint = await getBlueprint(env, tenantId, request.blueprintId);
  if (!blueprint) throw new Error("Process not found");
  const admission = await executionAdmission(env, tenantId, blueprint.status, blueprint.operatingMode ?? "active");
  if (admission.error) throw new Error(admission.error);
  if (blueprint.status === "draft") throw new Error("Process is draft");
  if (["drain", "emergency_stop"].includes(blueprint.operatingMode ?? "active")) {
    throw new Error(`Process operating mode is ${blueprint.operatingMode}`);
  }
  const promptReleaseId = blueprint.promptReleaseId;
  if (!promptReleaseId) throw new Error("Process has no published release");

  const instanceKey = instanceKeyFor(blueprint.executionProfile, request);
  const startedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO executions
    (id, tenant_id, blueprint_id, instance_key, execution_profile, status, input_preview, idempotency_key, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(executionId, tenantId, blueprint.id, instanceKey, blueprint.executionProfile,
      admission.deferred ? "deferred" : "running", request.input.slice(0, 500), request.idempotencyKey ?? null, startedAt).run();

  if (admission.deferred) {
    return { executionId, instanceKey, profile: blueprint.executionProfile, status: "deferred", startedAt };
  }
  await assertBudgetAvailable(env, tenantId);

  if (blueprint.executionProfile === "workflow") {
    await env.PROCESS_WORKFLOW.create({ id: executionId as `${string}-${string}-${string}-${string}-${string}`, params: { tenantId, request } });
    await markStatus(env, executionId, "queued");
    return { executionId, instanceKey, profile: blueprint.executionProfile, status: "queued", startedAt };
  }

  if (blueprint.executionProfile === "instant") {
    const prompt = await requiredPrompt(env, promptReleaseId);
    const result = await runModel(env, blueprint.modelProfile, prompt, request.input);
    await complete(env, executionId, result);
    return { executionId, instanceKey, profile: blueprint.executionProfile, status: "completed", ...result, startedAt };
  }

  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, instanceKey!);
  if (!await agent.hasPromptRelease(promptReleaseId)) {
    agent.installPromptBundle(await requiredPrompt(env, promptReleaseId));
  }
  const result = await agent.execute(request.input, blueprint.modelProfile);
  await complete(env, executionId, result);
  return { executionId, instanceKey, profile: blueprint.executionProfile, status: "completed", output: result.output, model: result.model, startedAt };
}

export async function assertAsyncExecutionAdmission(env: Env, tenantId: string, blueprintId: string) {
  const blueprint = await getBlueprint(env, tenantId, blueprintId);
  if (!blueprint) throw new Error("Process not found");
  const admission = await executionAdmission(env, tenantId, blueprint.status, blueprint.operatingMode ?? "active");
  if (admission.error) throw new Error(admission.error);
  return admission;
}

async function executionAdmission(env: Env, tenantId: string, processStatus: string, processMode: string) {
  const tenant = await env.DB.prepare("SELECT mode FROM tenant_operating_controls WHERE tenant_id = ?")
    .bind(tenantId).first<{ mode: string }>();
  const tenantMode = tenant?.mode ?? "active";
  if (tenantMode === "emergency_stop") return { deferred: false, error: "Tenant is in emergency stop" };
  if (tenantMode === "drain") return { deferred: false, error: "Tenant is draining and rejects new work" };
  if (processMode === "emergency_stop") return { deferred: false, error: "Process operating mode is emergency_stop" };
  if (processMode === "drain") return { deferred: false, error: "Process operating mode is drain" };
  return { deferred: processMode === "paused" || processStatus === "paused", error: null as string | null };
}

async function requiredPrompt(env: Env, releaseId: string): Promise<PromptBundle> {
  const prompt = await getPromptBundle(env, releaseId);
  if (!prompt) throw new Error("Published prompt release not found");
  return prompt;
}

async function markStatus(env: Env, id: string, status: string): Promise<void> {
  await env.DB.prepare("UPDATE executions SET status = ? WHERE id = ?").bind(status, id).run();
}

async function complete(env: Env, id: string, result: { output: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number }): Promise<void> {
  await env.DB.prepare(pricedCompletionSql())
    .bind(result.output.slice(0, 1000), result.model, result.inputTokens, result.outputTokens, result.totalTokens,
      result.inputTokens, result.model, result.outputTokens, result.model, new Date().toISOString(), id).run();
}
