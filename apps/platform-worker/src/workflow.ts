import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { ExecutionRequest } from "@workrr/contracts";
import { getBlueprint, getPromptBundle } from "./repository";
import { runModel } from "./model";
import type { Env } from "./types";
import { emitNotification } from "./notifications";
import { pricedCompletionSql } from "./usage";

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
    const result = await step.do("run model task", { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } }, () =>
      runModel(this.env, context.blueprint.modelProfile, context.prompt, request.input));
    await step.do("record durable result", async () => {
      await this.env.DB.prepare(`${pricedCompletionSql()} AND tenant_id = ?`)
        .bind(result.output.slice(0, 1000), result.model, result.inputTokens, result.outputTokens, result.totalTokens,
          result.inputTokens, result.model, result.outputTokens, result.model, new Date().toISOString(), event.instanceId, tenantId).run();
    });
    return { output: result.output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("record terminal failure", async () => {
        await this.env.DB.prepare("UPDATE executions SET status = 'failed', error = ?, completed_at = ? WHERE id = ? AND tenant_id = ?")
          .bind(message.slice(0, 1000), new Date().toISOString(), event.instanceId, tenantId).run();
      });
      await step.do("notify terminal failure", async () => {
        await emitNotification(this.env, tenantId, { eventType: "execution.failed", title: "Workflow execution failed",
          detail: message, targetType: "execution", targetId: event.instanceId });
      });
      throw error;
    }
  }
}
