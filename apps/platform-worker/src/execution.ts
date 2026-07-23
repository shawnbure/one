import { getAgentByName } from "agents";
import { instanceKeyFor, type ExecutionRequest, type ExecutionResult, type PromptBundle } from "@workrr/contracts";
import { runModel } from "./model";
import { getBlueprint, getBlueprintForPromptRelease, getBlueprintForRelease, getPromptBundle } from "./repository";
import type { ProcessAgent } from "./agent";
import type { Env } from "./types";
import { assertBudgetAvailable, pricedCompletionSql } from "./usage";
import { applyDlp, DlpBlockedError, isDlpBlocked } from "./dlp";
import { augmentWithKnowledge } from "./knowledge";
import { isContractViolation, outputContractInstruction, parseContracts,
  validateContractInput, validateContractOutput } from "./contracts";
import { autonomyPlan, routeApproval } from "./autonomy";
import { recordShadowReview } from "./shadow";

export async function executeRequest(env: Env, tenantId: string, request: ExecutionRequest, executionId: string = crypto.randomUUID()): Promise<ExecutionResult> {
  let blueprint = await getBlueprint(env, tenantId, request.blueprintId);
  if (!blueprint) throw new Error("Process not found");
  const instanceKey = instanceKeyFor(blueprint.executionProfile, request);
  let durableAgent: DurableObjectStub<ProcessAgent> | null = null;
  if (instanceKey) {
    durableAgent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, instanceKey);
    await durableAgent.bindTenant(tenantId, blueprint.id);
    let pinnedReleaseId = await durableAgent.pinnedReleaseId();
    if (!pinnedReleaseId) {
      const legacyPromptReleaseId = await durableAgent.pinnedPromptReleaseId();
      if (legacyPromptReleaseId) {
        const attributed = await getBlueprintForPromptRelease(env, tenantId, blueprint.id, legacyPromptReleaseId);
        if (!attributed?.activeReleaseId) {
          throw new Error("Legacy Agent actor references an unattributable prompt release");
        }
        await durableAgent.adoptProcessRelease(attributed.activeReleaseId, legacyPromptReleaseId);
        pinnedReleaseId = attributed.activeReleaseId;
      }
    }
    if (pinnedReleaseId && pinnedReleaseId !== blueprint.activeReleaseId) {
      const pinnedBlueprint = await getBlueprintForRelease(env, tenantId, blueprint.id, pinnedReleaseId);
      if (!pinnedBlueprint) throw new Error("Agent actor references an unavailable process release");
      blueprint = pinnedBlueprint;
    }
  }
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
  const autonomy = autonomyPlan(blueprint);
  const startedAt = new Date().toISOString();
  let contractedInput;
  try {
    contractedInput = validateContractInput(inputDlp.modelText, contracts.inputSchema);
  } catch (error) {
    if (isContractViolation(error)) {
      await env.DB.prepare(`INSERT OR IGNORE INTO executions
        (id, tenant_id, blueprint_id, instance_key, execution_profile, status, input_preview,
         idempotency_key, started_at, completed_at, process_release_id, input_contract_status,
         output_contract_status, contract_error, error, autonomy_level, autonomy_disposition, tool_policy_json)
        VALUES (?, ?, ?, ?, ?, 'blocked', ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?, 'blocked', ?)`)
        .bind(executionId, tenantId, blueprint.id, instanceKey, blueprint.executionProfile,
          inputDlp.safeText.slice(0, 500), request.idempotencyKey ?? null, startedAt, startedAt,
          blueprint.activeReleaseId ?? null, contracts.outputSchema ? "pending" : "not_configured",
          error.message.slice(0, 1000), error.message.slice(0, 1000), autonomy.effective,
          JSON.stringify(blueprint.toolPolicies ?? [])).run();
    }
    throw error;
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO executions
    (id, tenant_id, blueprint_id, instance_key, execution_profile, status, input_preview, idempotency_key,
     started_at, process_release_id, input_contract_status, output_contract_status, autonomy_level,
     autonomy_disposition, tool_policy_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(executionId, tenantId, blueprint.id, instanceKey, blueprint.executionProfile,
      admission.deferred ? "deferred" : "running", inputDlp.safeText.slice(0, 500), request.idempotencyKey ?? null,
      startedAt, blueprint.activeReleaseId ?? null, contractedInput.status,
      contracts.outputSchema ? "pending" : "not_configured", autonomy.effective,
      admission.deferred ? "deferred" : autonomy.disposition, JSON.stringify(blueprint.toolPolicies ?? [])).run();

  try {
    if (admission.deferred) {
      return { executionId, instanceKey, profile: blueprint.executionProfile, status: "deferred", startedAt };
    }
    if (!autonomy.runModel) {
      const output = "Input observed. This autonomy level does not generate an AI recommendation.";
      await env.DB.prepare(`UPDATE executions SET status='completed', output_preview=?, input_tokens=0,
        output_tokens=0, total_tokens=0, estimated_cost_usd=0, output_contract_status='not_configured',
        completed_at=? WHERE id=? AND tenant_id=?`)
        .bind(output, new Date().toISOString(), executionId, tenantId).run();
      return { executionId, instanceKey, profile: blueprint.executionProfile, status: "completed", output, startedAt };
    }
    await assertBudgetAvailable(env, tenantId, blueprint.id);

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
      const result = await runModel(env, blueprint.modelProfile, prompt, modelInput, undefined, {
        tenantId, executionId, autonomy: autonomy.effective, policies: blueprint.toolPolicies ?? [],
        dataClassification: blueprint.dataClassification ?? "internal"
      }, [], blueprint.modelId);
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
      const approvalId = await routeApproval(env, tenantId, executionId, blueprint,
        approvalPlan(autonomy, result.toolApprovalRequired), contractedOutput.value);
      if (!approvalId) await markAutonomyDisposition(env, executionId, autonomy.disposition);
      if (autonomy.shadowMode) await recordShadowReview(env, tenantId, executionId, blueprint.id);
      return { executionId, instanceKey, profile: blueprint.executionProfile,
        status: approvalId ? "waiting_approval" : "completed",
        ...(approvalId ? {} : safeResult), startedAt };
    }

    const agent = durableAgent!;
    if (!await agent.hasPromptRelease(promptReleaseId)) {
      if (!blueprint.activeReleaseId) throw new Error("Durable process has no immutable process release");
      await agent.installPromptBundle(await requiredPrompt(env, promptReleaseId), tenantId, blueprint.activeReleaseId);
    }
    let result;
    try {
      result = await agent.execute(modelInput, inputDlp.safeText, blueprint.modelProfile, blueprint.modelId ?? null, executionId,
        contracts.outputSchema, !autonomy.requiresApproval && !autonomy.shadowMode,
        autonomy.effective, blueprint.toolPolicies ?? [], blueprint.dataClassification ?? "internal");
    } catch (error) {
      if (isDlpBlocked(error)) await failBlockedOutput(env, executionId,
        error instanceof DlpBlockedError ? error.detectors : ["sensitive content"]);
      if (isContractViolation(error)) await failContractOutput(env, executionId, error);
      throw error;
    }
    await markOutputContract(env, executionId, contracts.outputSchema ? "passed" : "not_configured");
    await complete(env, executionId, result, result.outputPreview);
    const approvalId = await routeApproval(env, tenantId, executionId, blueprint,
      approvalPlan(autonomy, result.toolApprovalRequired), result.outputPreview);
    if (!approvalId) await markAutonomyDisposition(env, executionId, autonomy.disposition);
    if (autonomy.shadowMode) await recordShadowReview(env, tenantId, executionId, blueprint.id);
    return { executionId, instanceKey, profile: blueprint.executionProfile,
      status: approvalId ? "waiting_approval" : "completed",
      ...(approvalId ? {} : { output: result.output, model: result.model }), startedAt };
  } catch (error) {
    await failUnexpectedExecution(env, tenantId, executionId, error);
    throw error;
  }
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

async function complete(env: Env, id: string, result: {
  output: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number;
  inferenceProvider: "workers_ai" | "ai_gateway"; gatewayId: string | null; gatewayStep: number | null;
  gatewayCacheStatus: string | null; gatewayLogId: string | null;
},
  outputPreview = result.output): Promise<void> {
  await env.DB.prepare(pricedCompletionSql())
    .bind(outputPreview.slice(0, 1000), result.model, result.inputTokens, result.outputTokens, result.totalTokens,
      result.inputTokens, result.model, result.outputTokens, result.model,
      result.inferenceProvider, result.gatewayId, result.gatewayStep, result.gatewayCacheStatus, result.gatewayLogId,
      new Date().toISOString(), id).run();
}

async function failBlockedOutput(env: Env, id: string, detectors: string[]) {
  await env.DB.prepare("UPDATE executions SET status='blocked', output_preview=NULL, error=?, completed_at=? WHERE id=?")
    .bind(`DLP blocked model output containing: ${detectors.join(", ")}`, new Date().toISOString(), id).run();
}

async function markOutputContract(env: Env, id: string, status: "passed" | "not_configured") {
  await env.DB.prepare("UPDATE executions SET output_contract_status=? WHERE id=?").bind(status, id).run();
}
async function markAutonomyDisposition(env: Env, id: string, disposition: string) {
  await env.DB.prepare("UPDATE executions SET autonomy_disposition=? WHERE id=?").bind(disposition, id).run();
}
async function failContractOutput(env: Env, id: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await env.DB.prepare(`UPDATE executions SET status='failed', output_preview=NULL, output_contract_status='failed',
    contract_error=?, error=?, completed_at=? WHERE id=?`)
    .bind(message.slice(0, 1000), message.slice(0, 1000), new Date().toISOString(), id).run();
}

async function failUnexpectedExecution(env: Env, tenantId: string, id: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await env.DB.prepare(`UPDATE executions SET status='failed', output_preview=NULL, error=?, completed_at=?
    WHERE id=? AND tenant_id=? AND status IN ('running','queued','completed')`)
    .bind(message.slice(0, 1000), new Date().toISOString(), id, tenantId).run();
}

function approvalPlan(plan: ReturnType<typeof autonomyPlan>, toolApprovalRequired: boolean) {
  if (plan.shadowMode) return plan;
  if (!toolApprovalRequired || plan.requiresApproval) return plan;
  return {
    ...plan,
    disposition: "waiting_approval" as const,
    requiresApproval: true,
    explanation: "A requested capability is proposal-only, so no external action was performed and human approval is required."
  };
}
