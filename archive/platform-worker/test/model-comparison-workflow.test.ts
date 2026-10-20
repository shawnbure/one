import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/evaluation", () => ({ runEvaluation: vi.fn() }));
vi.mock("../src/notifications", () => ({ emitNotification: vi.fn() }));
import { runEvaluation } from "../src/evaluation";
import { EvaluationWorkflow } from "../src/evaluation-workflow";

const step = {
  async do<T>(_name: string, optionsOrCallback: unknown, maybeCallback?: () => Promise<T>) {
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback as () => Promise<T> : maybeCallback!;
    return callback();
  }
};

function trialEnvironment() {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async run() { writes.push({ sql, values }); return { meta: { changes: 1 } }; }
      };
      return statement;
    }
  };
  return { DB, writes };
}

const params = {
  kind: "model_comparison" as const, tenantId: "tenant-1", actorId: "actor-1", trialId: "trial-1",
  scenarioId: "scenario-1", releaseId: "release-1", baselineProfile: "balanced", candidateProfile: "fast",
  baselineRunId: "baseline-run", candidateRunId: "candidate-run"
};

describe("model comparison Workflow", () => {
  beforeEach(() => vi.mocked(runEvaluation).mockReset());

  it("runs both profiles against the same release without updating the gate", async () => {
    vi.mocked(runEvaluation)
      .mockResolvedValueOnce({ id: "baseline-run", score: 0.9, estimatedCostUsd: 0.02, totalTokens: 400 } as never)
      .mockResolvedValueOnce({ id: "candidate-run", score: 0.9, estimatedCostUsd: 0.01, totalTokens: 300 } as never);
    const { DB, writes } = trialEnvironment();
    const workflow = new EvaluationWorkflow() as EvaluationWorkflow & { env: unknown };
    workflow.env = { DB };
    const result = await workflow.run({ payload: params } as never, step as never) as { recommendation: string };
    expect(runEvaluation).toHaveBeenNthCalledWith(1, expect.anything(), "tenant-1", "actor-1", "scenario-1",
      "release-1", "baseline-run", "balanced", false);
    expect(runEvaluation).toHaveBeenNthCalledWith(2, expect.anything(), "tenant-1", "actor-1", "scenario-1",
      "release-1", "candidate-run", "fast", false);
    expect(result.recommendation).toContain("lower estimated cost");
    expect(writes.some(({ sql, values }) => sql.includes("baseline_score") && values.includes(0.9))).toBe(true);
  });
});
