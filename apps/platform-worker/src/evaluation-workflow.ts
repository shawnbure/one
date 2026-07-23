import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runEvaluation } from "./evaluation";
import { emitNotification } from "./notifications";
import type { Env } from "./types";

export interface EvaluationWorkflowParams {
  tenantId: string;
  actorId: string;
  suiteId: string;
  scenarioId: string;
  releaseId: string;
  evaluationRunId: string;
}

export class EvaluationWorkflow extends WorkflowEntrypoint<Env, EvaluationWorkflowParams> {
  async run(event: WorkflowEvent<EvaluationWorkflowParams>, step: WorkflowStep) {
    const params = event.payload;
    try {
      await step.do("mark evaluation suite running", async () => {
        await this.env.DB.prepare(`UPDATE evaluation_suite_runs SET status = 'running', started_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ? AND status = 'queued'`).bind(params.suiteId, params.tenantId).run();
      });
      const result = await step.do("run exact release regression", {
        retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }
      }, () => runEvaluation(this.env, params.tenantId, params.actorId, params.scenarioId, params.releaseId, params.evaluationRunId));
      await step.do("record evaluation suite outcome", async () => {
        await this.env.DB.prepare(`UPDATE evaluation_suite_runs SET status = ?, score = ?, evaluation_run_id = ?,
          completed_at = CURRENT_TIMESTAMP, error = NULL WHERE id = ? AND tenant_id = ?`)
          .bind(result.status, result.score, result.id, params.suiteId, params.tenantId).run();
      });
      return { suiteId: params.suiteId, evaluationRunId: result.id, status: result.status, score: result.score };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("record evaluation suite failure", async () => {
        await this.env.DB.prepare(`UPDATE evaluation_suite_runs SET status = 'error', error = ?,
          completed_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`)
          .bind(message.slice(0, 500), params.suiteId, params.tenantId).run();
      });
      await step.do("notify evaluation suite failure", () => emitNotification(this.env, params.tenantId, {
        eventType: "evaluation.failed", title: "Evaluation suite failed", detail: message,
        targetType: "evaluation_suite", targetId: params.suiteId
      }));
      throw error;
    }
  }
}
