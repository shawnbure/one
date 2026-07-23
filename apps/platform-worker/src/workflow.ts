import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { ExecutionRequest } from "@workrr/contracts";
import { getBlueprint, getPromptBundle } from "./repository";
import { runModel } from "./model";
import type { Env } from "./types";
import { emitNotification } from "./notifications";
import { pricedCompletionSql } from "./usage";
import { applyDlp, DlpBlockedError, isDlpBlocked } from "./dlp";

interface ProcessWorkflowParams { tenantId: string; request: ExecutionRequest }

export class ProcessWorkflow extends WorkflowEntrypoint<Env, ProcessWorkflowParams> {
  async run(event: WorkflowEvent<ProcessWorkflowParams>, step: WorkflowStep): Promise<{ output: string }> {
    const { tenantId, request } = event.payload;
    try {
    const context = await step.do("load immutable process release", async () => {
      const blueprint = await getBlueprint(this.env, tenantId, request.blueprintId);
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
      return result.modelText;
    });
    const rawResult = await step.do("run model task", { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } }, () =>
      runModel(this.env, context.blueprint.modelProfile, context.prompt, protectedInput));
    const result = await step.do("enforce output DLP policy", async () => {
      const protectedOutput = await applyDlp(this.env, tenantId, rawResult.output, {
        direction: "output", stage: "workflow", executionId: event.instanceId, blueprintId: request.blueprintId
      });
      if (protectedOutput.blocked) throw new DlpBlockedError(protectedOutput.blockedDetectors);
      return { ...rawResult, output: protectedOutput.modelText, outputPreview: protectedOutput.safeText };
    });
    await step.do("record durable result", async () => {
      const completedAt = new Date().toISOString();
      await this.env.DB.batch([
        this.env.DB.prepare(`${pricedCompletionSql()} AND tenant_id = ?`)
          .bind(result.outputPreview.slice(0, 1000), result.model, result.inputTokens, result.outputTokens, result.totalTokens,
            result.inputTokens, result.model, result.outputTokens, result.model, completedAt, event.instanceId, tenantId),
        this.env.DB.prepare(`UPDATE schedule_dispatches SET status = 'completed', completed_at = ?, error = NULL
          WHERE execution_id = ? AND tenant_id = ?`).bind(completedAt, event.instanceId, tenantId)
      ]);
    });
    return { output: result.output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("record terminal failure", async () => {
        const completedAt = new Date().toISOString();
        await this.env.DB.batch([
          this.env.DB.prepare("UPDATE executions SET status = ?, error = ?, completed_at = ? WHERE id = ? AND tenant_id = ?")
            .bind(isDlpBlocked(error) ? "blocked" : "failed", message.slice(0, 1000),
              completedAt, event.instanceId, tenantId),
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
