import { getAgentByName } from "agents";
import { instanceKeyFor, type ExecutionRequest, type ExecutionResult, type PromptBundle } from "@workrr/contracts";
import { runModel } from "./model";
import { getBlueprint, getPromptBundle } from "./repository";
import type { ProcessAgent } from "./agent";
import type { Env } from "./types";
import { assertBudgetAvailable, pricedCompletionSql } from "./usage";
import { applyDlp, DlpBlockedError, isDlpBlocked } from "./dlp";
import { augmentWithKnowledge } from "./knowledge";
import { isContractViolation, outputContractInstruction, parseContracts,
  validateContractInput, validateContractOutput } from "./contracts";

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

  const inputDlp = await applyDlp(env, tenantId, request.input, {
    direction: "input", stage: "execution", executionId, blueprintId: blueprint.id
  });
  if (inputDlp.blocked) throw new DlpBlockedError(inputDlp.blockedDetectors);
  const contracts = parseContracts(blueprint.inputSchemaJson, blueprint.outputSchemaJson);
  const instanceKey = instanceKeyFor(blueprint.executionProfile, request);
  const startedAt = new Date().toISOString();
  let contractedInput;
  try {
    contractedInput = validateContractInput(inputDlp.modelText, contracts.inputSchema);
  } catch (error) {
    if (isContractViolation(error)) {
      await env.DB.prepare(`INSERT OR IGNORE INTO executions
        (id, tenant_id, blueprint_id, instance_key, execution_profile, status, input_preview,
         idempotency_key, started_at, completed_at, process_release_id, input_contract_status,
         output_contract_status, contract_error, error)
        VALUES (?, ?, ?, ?, ?, 'blocked', ?, ?, ?, ?, ?, 'failed', ?, ?, ?)`)
        .bind(executionId, tenantId, blueprint.id, instanceKey, blueprint.executionProfile,
          inputDlp.safeText.slice(0, 500), request.idempotencyKey ?? null, startedAt, startedAt,
          blueprint.activeReleaseId ?? null, contracts.outputSchema ? "pending" : "not_configured",
          error.message.slice(0, 1000), error.message.slice(0, 1000)).run();
    }
    throw error;
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO executions
    (id, tenant_id, blueprint_id, instance_key, execution_profile, status, input_preview, idempotency_key,
     started_at, process_release_id, input_contract_status, output_contract_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(executionId, tenantId, blueprint.id, instanceKey, blueprint.executionProfile,
      admission.deferred ? "deferred" : "running", inputDlp.safeText.slice(0, 500), request.idempotencyKey ?? null,
      startedAt, blueprint.activeReleaseId ?? null, contractedInput.status,
      contracts.outputSchema ? "pending" : "not_configured").run();

  if (admission.deferred) {
    return { executionId, instanceKey, profile: blueprint.executionProfile, status: "deferred", startedAt };
  }
  await assertBudgetAvailable(env, tenantId);

  if (blueprint.executionProfile === "workflow") {
    await env.PROCESS_WORKFLOW.create({ id: executionId as `${string}-${string}-${string}-${string}-${string}`,
      params: { tenantId, request: { ...request, input: contractedInput.value } } });
    await markStatus(env, executionId, "queued");
    return { executionId, instanceKey, profile: blueprint.executionProfile, status: "queued", startedAt };
  }

  const grounded = await augmentWithKnowledge(env, tenantId, blueprint.id, contractedInput.value, executionId);
  const modelInput = outputContractInstruction(grounded.input, contracts.outputSchema);
  if (blueprint.executionProfile === "instant") {
    const prompt = await requiredPrompt(env, promptReleaseId);
    const result = await runModel(env, blueprint.modelProfile, prompt, modelInput);
    const outputDlp = await applyDlp(env, tenantId, result.output, {
      direction: "output", stage: "execution", executionId, blueprintId: blueprint.id
    });
    if (outputDlp.blocked) {
      await failBlockedOutput(env, executionId, outputDlp.blockedDetectors);
      throw new DlpBlockedError(outputDlp.blockedDetectors);
    }
    let contractedOutput;
    try { contractedOutput = validateContractOutput(outputDlp.modelText, contracts.outputSchema); }
    catch (error) { await failContractOutput(env, executionId, error); throw error; }
    const safeResult = { ...result, output: contractedOutput.value };
    await markOutputContract(env, executionId, contractedOutput.status);
    await complete(env, executionId, safeResult, contractedOutput.value);
    return { executionId, instanceKey, profile: blueprint.executionProfile, status: "completed", ...safeResult, startedAt };
  }

  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, instanceKey!);
  await agent.bindTenant(tenantId, blueprint.id);
  if (!await agent.hasPromptRelease(promptReleaseId)) {
    agent.installPromptBundle(await requiredPrompt(env, promptReleaseId), tenantId);
  }
  let result;
  try {
    result = await agent.execute(modelInput, inputDlp.safeText, blueprint.modelProfile, executionId, contracts.outputSchema);
  } catch (error) {
    if (isDlpBlocked(error)) await failBlockedOutput(env, executionId,
      error instanceof DlpBlockedError ? error.detectors : ["sensitive content"]);
    if (isContractViolation(error)) await failContractOutput(env, executionId, error);
    throw error;
  }
  await markOutputContract(env, executionId, contracts.outputSchema ? "passed" : "not_configured");
  await complete(env, executionId, result, result.outputPreview);
  return { executionId, instanceKey, profile: blueprint.executionProfile, status: "completed", output: result.output, model: result.model, startedAt };
}

export async function sanitizeAsyncExecutionInput(env: Env, tenantId: string, request: ExecutionRequest, executionId: string) {
  const result = await applyDlp(env, tenantId, request.input, {
    direction: "input", stage: "queue_admission", executionId, blueprintId: request.blueprintId
  });
  if (result.blocked) throw new DlpBlockedError(result.blockedDetectors);
  const blueprint = await getBlueprint(env, tenantId, request.blueprintId);
  if (!blueprint) throw new Error("Process not found");
  const contracted = validateContractInput(result.modelText,
    parseContracts(blueprint.inputSchemaJson, blueprint.outputSchemaJson).inputSchema);
  return { ...request, input: contracted.value };
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

async function complete(env: Env, id: string, result: { output: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number },
  outputPreview = result.output): Promise<void> {
  await env.DB.prepare(pricedCompletionSql())
    .bind(outputPreview.slice(0, 1000), result.model, result.inputTokens, result.outputTokens, result.totalTokens,
      result.inputTokens, result.model, result.outputTokens, result.model, new Date().toISOString(), id).run();
}

async function failBlockedOutput(env: Env, id: string, detectors: string[]) {
  await env.DB.prepare("UPDATE executions SET status='blocked', output_preview=NULL, error=?, completed_at=? WHERE id=?")
    .bind(`DLP blocked model output containing: ${detectors.join(", ")}`, new Date().toISOString(), id).run();
}

async function markOutputContract(env: Env, id: string, status: "passed" | "not_configured") {
  await env.DB.prepare("UPDATE executions SET output_contract_status=? WHERE id=?").bind(status, id).run();
}
async function failContractOutput(env: Env, id: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await env.DB.prepare(`UPDATE executions SET status='failed', output_preview=NULL, output_contract_status='failed',
    contract_error=?, error=?, completed_at=? WHERE id=?`)
    .bind(message.slice(0, 1000), message.slice(0, 1000), new Date().toISOString(), id).run();
}
