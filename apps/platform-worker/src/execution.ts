import { getAgentByName } from "agents";
import { instanceKeyFor, type ExecutionRequest, type ExecutionResult, type PromptBundle } from "@workrr/contracts";
import { runModel } from "./model";
import { getBlueprint, getPromptBundle } from "./repository";
import type { ProcessAgent } from "./agent";
import type { Env } from "./types";

export async function executeRequest(env: Env, tenantId: string, request: ExecutionRequest, executionId: string = crypto.randomUUID()): Promise<ExecutionResult> {
  const blueprint = await getBlueprint(env, tenantId, request.blueprintId);
  if (!blueprint) throw new Error("Process not found");
  if (blueprint.status === "paused" || blueprint.status === "draft") throw new Error(`Process is ${blueprint.status}`);
  if (["paused", "drain", "emergency_stop"].includes(blueprint.operatingMode ?? "active")) {
    throw new Error(`Process operating mode is ${blueprint.operatingMode}`);
  }
  const promptReleaseId = blueprint.promptReleaseId;
  if (!promptReleaseId) throw new Error("Process has no published release");

  const instanceKey = instanceKeyFor(blueprint.executionProfile, request);
  const startedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO executions
    (id, tenant_id, blueprint_id, instance_key, execution_profile, status, input_preview, idempotency_key, started_at)
    VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`)
    .bind(executionId, tenantId, blueprint.id, instanceKey, blueprint.executionProfile, request.input.slice(0, 500), request.idempotencyKey ?? null, startedAt).run();

  if (blueprint.executionProfile === "workflow") {
    await env.PROCESS_WORKFLOW.create({ id: executionId as `${string}-${string}-${string}-${string}-${string}`, params: { tenantId, request } });
    await markStatus(env, executionId, "queued");
    return { executionId, instanceKey, profile: blueprint.executionProfile, status: "queued", startedAt };
  }

  if (blueprint.executionProfile === "instant") {
    const prompt = await requiredPrompt(env, promptReleaseId);
    const result = await runModel(env, blueprint.modelProfile, prompt, request.input);
    await complete(env, executionId, result.output, result.model);
    return { executionId, instanceKey, profile: blueprint.executionProfile, status: "completed", ...result, startedAt };
  }

  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, instanceKey!);
  if (!await agent.hasPromptRelease(promptReleaseId)) {
    agent.installPromptBundle(await requiredPrompt(env, promptReleaseId));
  }
  const result = await agent.execute(request.input, blueprint.modelProfile);
  await complete(env, executionId, result.output, result.model);
  return { executionId, instanceKey, profile: blueprint.executionProfile, status: "completed", output: result.output, model: result.model, startedAt };
}

async function requiredPrompt(env: Env, releaseId: string): Promise<PromptBundle> {
  const prompt = await getPromptBundle(env, releaseId);
  if (!prompt) throw new Error("Published prompt release not found");
  return prompt;
}

async function markStatus(env: Env, id: string, status: string): Promise<void> {
  await env.DB.prepare("UPDATE executions SET status = ? WHERE id = ?").bind(status, id).run();
}

async function complete(env: Env, id: string, output: string, model: string): Promise<void> {
  await env.DB.prepare("UPDATE executions SET status = 'completed', output_preview = ?, model = ?, completed_at = ? WHERE id = ?")
    .bind(output.slice(0, 1000), model, new Date().toISOString(), id).run();
}
