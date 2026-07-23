import { describe, expect, it, vi } from "vitest";
import { queueEvaluationSuite, reviewEvaluationResult } from "../src/evaluation";

function operationsEnvironment(options: { caseResultExists?: boolean; workflowFails?: boolean } = {}) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const create = vi.fn(async () => {
    if (options.workflowFails) throw new Error("workflow unavailable");
    return {};
  });
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first() {
          if (sql.includes("FROM tenant_budgets")) return null;
          if (sql.includes("FROM evaluation_scenarios")) return {
            id: "scenario-1", blueprint_id: "process-1", active_release_id: "release-1"
          };
          if (sql.includes("FROM process_releases")) return { id: "release-1" };
          if (sql.includes("FROM evaluation_case_results")) return options.caseResultExists === false ? null : { id: "result-1" };
          return null;
        },
        async run() { writes.push({ sql, values }); return { meta: { changes: 1 } }; }
      };
      return statement;
    }
  };
  return { env: { DB, EVALUATION_WORKFLOW: { create } } as never, writes, create };
}

describe("durable evaluation operations", () => {
  it("queues a tenant-scoped exact-release suite in Cloudflare Workflows", async () => {
    const { env, writes, create } = operationsEnvironment();
    const result = await queueEvaluationSuite(env, "tenant-1", "actor-1", "scenario-1");
    expect(result.status).toBe("queued");
    expect(result.releaseId).toBe("release-1");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      id: result.id,
      params: expect.objectContaining({ tenantId: "tenant-1", scenarioId: "scenario-1", releaseId: "release-1" })
    }));
    expect(writes.some(({ sql, values }) => sql.includes("INSERT INTO evaluation_suite_runs") &&
      values.includes("tenant-1") && values.includes("process-1"))).toBe(true);
  });

  it("persists a terminal suite error if Workflow creation fails", async () => {
    const { env, writes } = operationsEnvironment({ workflowFails: true });
    await expect(queueEvaluationSuite(env, "tenant-1", "actor-1", "scenario-1")).rejects.toThrow("workflow unavailable");
    expect(writes.some(({ sql }) => sql.includes("status = 'error'"))).toBe(true);
  });

  it("refuses a human score for a result outside the tenant", async () => {
    const { env } = operationsEnvironment({ caseResultExists: false });
    await expect(reviewEvaluationResult(env, "tenant-1", "reviewer-1", "result-other", {
      score: 5, verdict: "acceptable"
    })).rejects.toThrow("not found");
  });

  it("upserts a bounded human scorecard", async () => {
    const { env, writes } = operationsEnvironment();
    const result = await reviewEvaluationResult(env, "tenant-1", "reviewer-1", "result-1", {
      score: 3, verdict: "needs_work", notes: "Correct but too verbose"
    });
    expect(result).toMatchObject({ caseResultId: "result-1", score: 3, verdict: "needs_work" });
    expect(writes.some(({ sql, values }) => sql.includes("evaluation_human_reviews") &&
      values.includes("tenant-1") && values.includes("reviewer-1"))).toBe(true);
  });
});
