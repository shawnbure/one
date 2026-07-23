import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { ExecutionRequest } from "@workrr/contracts";
import { getBlueprintForRelease, getPromptBundle } from "./repository";
import { runModel } from "./model";
import type { Env } from "./types";
import { emitNotification } from "./notifications";
import { assertBudgetAvailable, pricedCompletionSql } from "./usage";
import { applyDlp, DlpBlockedError, isDlpBlocked } from "./dlp";
import { augmentWithKnowledge } from "./knowledge";
import { isContractViolation, outputContractInstruction, parseContracts, validateContractInput, validateContractOutput } from "./contracts";
import { autonomyPlan, routeApproval } from "./autonomy";
import { recordShadowReview } from "./shadow";

interface ProcessWorkflowParams { tenantId: string; request: ExecutionRequest }

export class ProcessWorkflow extends WorkflowEntrypoint<Env, ProcessWorkflowParams> {
  async run(event: WorkflowEvent<ProcessWorkflowParams>, step: WorkflowStep): Promise<{ output: string }> {
    const { tenantId, request } = event.payload;
    try {
    const context = await step.do("load immutable process release", async () => {
      const admitted = await this.env.DB.prepare(`SELECT process_release_id FROM executions
        WHERE id=? AND tenant_id=? AND blueprint_id=?`).bind(event.instanceId, tenantId, request.blueprintId)
        .first<{ process_release_id: string | null }>();
      if (!admitted?.process_release_id) throw new Error("Workflow execution has no admitted process release");
      const blueprint = await getBlueprintForRelease(this.env, tenantId, request.blueprintId, admitted.process_release_id);
      if (!blueprint) throw new Error("Process not found");
      if (!blueprint.promptReleaseId) throw new Error("Process has no published release");
      const prompt = await getPromptBundle(this.env, blueprint.promptReleaseId);
      if (!prompt) throw new Error("Prompt release not found");
      return { blueprint, prompt };
    });
    const protectedInput = await step.do("recheck input DLP policy", async () => {
      const result = await applyDlp(this.env, tenantId, request.input, {
        direction: "input", stage: "workflow", executionId: event.instanceId, blueprintId: request.blueprintId
      });
      if (result.blocked) throw new DlpBlockedError(result.blockedDetectors);
      const contracts = parseContracts(context.blueprint.inputSchemaJson, context.blueprint.outputSchemaJson);
      return validateContractInput(result.modelText, contracts.inputSchema).value;
    });
    const groundedInput = await step.do("retrieve approved knowledge", async () => {
      const grounded = await augmentWithKnowledge(this.env, tenantId, request.blueprintId, protectedInput, event.instanceId);
      const contracts = parseContracts(context.blueprint.inputSchemaJson, context.blueprint.outputSchemaJson);
      return outputContractInstruction(grounded.input, contracts.outputSchema);
    });
    await step.do("recheck AI budget", () =>
      assertBudgetAvailable(this.env, tenantId, request.blueprintId));
    const rawResult = await step.do("run model task", { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } }, () =>
      runModel(this.env, context.blueprint.modelProfile, context.prompt, groundedInput, undefined, {
        tenantId, executionId: event.instanceId, autonomy: autonomyPlan(context.blueprint).effective,
        policies: context.blueprint.toolPolicies ?? [],
        dataClassification: context.blueprint.dataClassification ?? "internal"
      }, [], context.blueprint.modelId));
    const result = await step.do("enforce output DLP policy", async () => {
      const protectedOutput = await applyDlp(this.env, tenantId, rawResult.output, {
        direction: "output", stage: "workflow", executionId: event.instanceId, blueprintId: request.blueprintId
      });
      if (protectedOutput.blocked) throw new DlpBlockedError(protectedOutput.blockedDetectors);
      const contracts = parseContracts(context.blueprint.inputSchemaJson, context.blueprint.outputSchemaJson);
      const contracted = validateContractOutput(protectedOutput.modelText, contracts.outputSchema);
      return { ...rawResult, output: contracted.value, outputPreview: contracted.value,
        outputContractStatus: contracts.outputSchema ? "passed" : "not_configured" };
    });
    await step.do("record durable result", async () => {
      const completedAt = new Date().toISOString();
      const autonomy = autonomyPlan(context.blueprint);
      await this.env.DB.batch([
        this.env.DB.prepare(`${pricedCompletionSql()} AND tenant_id = ?`)
          .bind(result.outputPreview.slice(0, 1000), result.model, result.inputTokens, result.outputTokens, result.totalTokens,
            result.inputTokens, result.model, result.outputTokens, result.model,
            result.inferenceProvider, result.gatewayId, result.gatewayStep, result.gatewayCacheStatus, result.gatewayLogId,
            completedAt, event.instanceId, tenantId),
        this.env.DB.prepare("UPDATE executions SET output_contract_status=? WHERE id=? AND tenant_id=?")
          .bind(result.outputContractStatus, event.instanceId, tenantId),
        this.env.DB.prepare("UPDATE executions SET autonomy_level=?, autonomy_disposition=? WHERE id=? AND tenant_id=?")
          .bind(autonomy.effective, autonomy.disposition, event.instanceId, tenantId),
        this.env.DB.prepare(`UPDATE schedule_dispatches SET status = 'completed', completed_at = ?, error = NULL
          WHERE execution_id = ? AND tenant_id = ?`).bind(completedAt, event.instanceId, tenantId)
      ]);
    });
    const approvalId = await step.do("apply autonomy policy", async () => {
      const autonomy = autonomyPlan(context.blueprint);
      const plan = rawResult.toolApprovalRequired && !autonomy.requiresApproval && !autonomy.shadowMode
        ? { ...autonomy, disposition: "waiting_approval" as const, requiresApproval: true,
          explanation: "A requested capability is proposal-only, so no external action was performed and human approval is required." }
        : autonomy;
      return routeApproval(this.env, tenantId, event.instanceId, context.blueprint, plan, result.outputPreview);
    });
    if (autonomyPlan(context.blueprint).shadowMode) {
      await step.do("record shadow comparison", () =>
        recordShadowReview(this.env, tenantId, event.instanceId, context.blueprint.id));
    }
    return { output: approvalId ? "Result is waiting for human approval." : result.output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("record terminal failure", async () => {
        const completedAt = new Date().toISOString();
        await this.env.DB.batch([
          this.env.DB.prepare(`UPDATE executions SET status = ?, error = ?, completed_at = ?,
            output_contract_status=CASE WHEN ?=1 THEN 'failed' ELSE output_contract_status END,
            contract_error=CASE WHEN ?=1 THEN ? ELSE contract_error END WHERE id = ? AND tenant_id = ?`)
            .bind(isDlpBlocked(error) ? "blocked" : "failed", message.slice(0, 1000),
              completedAt, Number(isContractViolation(error)), Number(isContractViolation(error)), message.slice(0, 1000),
              event.instanceId, tenantId),
          this.env.DB.prepare(`UPDATE schedule_dispatches SET status = 'failed', error = ?, completed_at = ?
            WHERE execution_id = ? AND tenant_id = ?`).bind(message.slice(0, 500), completedAt, event.instanceId, tenantId)
        ]);
      });
      await step.do("notify terminal failure", async () => {
        await emitNotification(this.env, tenantId, { eventType: "execution.failed", title: "Workflow execution failed",
          detail: message, targetType: "execution", targetId: event.instanceId });
      });
      throw error;
    }
  }
}
