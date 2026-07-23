import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runEvaluation } from "./evaluation";
import { emitNotification } from "./notifications";
import type { Env } from "./types";

export interface EvaluationWorkflowParams {
  kind?: "suite";
  tenantId: string;
  actorId: string;
  suiteId: string;
  scenarioId: string;
  releaseId: string;
  evaluationRunId: string;
}

export interface ModelComparisonWorkflowParams {
  kind: "model_comparison";
  tenantId: string;
  actorId: string;
  trialId: string;
  scenarioId: string;
  releaseId: string;
  baselineProfile: string;
  candidateProfile: string;
  baselineRunId: string;
  candidateRunId: string;
}

export class EvaluationWorkflow extends WorkflowEntrypoint<Env, EvaluationWorkflowParams | ModelComparisonWorkflowParams> {
  async run(event: WorkflowEvent<EvaluationWorkflowParams | ModelComparisonWorkflowParams>, step: WorkflowStep) {
    const params = event.payload;
    if (params.kind === "model_comparison") return this.runModelComparison(params, step);
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

  private async runModelComparison(params: ModelComparisonWorkflowParams, step: WorkflowStep) {
    try {
      await step.do("mark model trial running", async () => {
        await this.env.DB.prepare(`UPDATE evaluation_model_trials SET status = 'running', started_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ? AND status = 'queued'`).bind(params.trialId, params.tenantId).run();
      });
      const baseline = await step.do("evaluate baseline model profile", {
        retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }
      }, () => runEvaluation(this.env, params.tenantId, params.actorId, params.scenarioId, params.releaseId,
        params.baselineRunId, params.baselineProfile, false));
      const candidate = await step.do("evaluate candidate model profile", {
        retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }
      }, () => runEvaluation(this.env, params.tenantId, params.actorId, params.scenarioId, params.releaseId,
        params.candidateRunId, params.candidateProfile, false));
      const recommendation = recommendProfile(baseline, candidate, params.baselineProfile, params.candidateProfile);
      await step.do("record model trial comparison", async () => {
        await this.env.DB.prepare(`UPDATE evaluation_model_trials SET status = 'completed', baseline_score = ?,
          candidate_score = ?, baseline_cost_usd = ?, candidate_cost_usd = ?, baseline_tokens = ?, candidate_tokens = ?,
          recommendation = ?, completed_at = CURRENT_TIMESTAMP, error = NULL WHERE id = ? AND tenant_id = ?`)
          .bind(baseline.score, candidate.score, baseline.estimatedCostUsd, candidate.estimatedCostUsd,
            baseline.totalTokens, candidate.totalTokens, recommendation, params.trialId, params.tenantId).run();
      });
      return { trialId: params.trialId, status: "completed", recommendation, baseline, candidate };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("record model trial failure", async () => {
        await this.env.DB.prepare(`UPDATE evaluation_model_trials SET status = 'error', error = ?,
          completed_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`)
          .bind(message.slice(0, 500), params.trialId, params.tenantId).run();
      });
      await step.do("notify model trial failure", () => emitNotification(this.env, params.tenantId, {
        eventType: "evaluation.failed", title: "Model comparison failed", detail: message,
        targetType: "evaluation_model_trial", targetId: params.trialId
      }));
      throw error;
    }
  }
}

function recommendProfile(
  baseline: { score: number; estimatedCostUsd: number },
  candidate: { score: number; estimatedCostUsd: number },
  baselineProfile: string,
  candidateProfile: string
) {
  if (candidate.score > baseline.score + 0.001) return `${candidateProfile} has the stronger quality score`;
  if (baseline.score > candidate.score + 0.001) return `${baselineProfile} has the stronger quality score`;
  if (candidate.estimatedCostUsd < baseline.estimatedCostUsd) return `${candidateProfile} matches quality at lower estimated cost`;
  if (baseline.estimatedCostUsd < candidate.estimatedCostUsd) return `${baselineProfile} matches quality at lower estimated cost`;
  return "Profiles are equivalent on this dataset; retain the current release profile";
}
