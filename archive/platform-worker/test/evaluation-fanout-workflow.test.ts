import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/evaluation", () => ({
  runEvaluation: vi.fn(),
  prepareEvaluationRun: vi.fn(),
  evaluatePreparedCase: vi.fn(),
  persistEvaluationRun: vi.fn()
}));
vi.mock("../src/notifications", () => ({ emitNotification: vi.fn() }));

import {
  evaluatePreparedCase,
  persistEvaluationRun,
  prepareEvaluationRun
} from "../src/evaluation";
import { EvaluationWorkflow } from "../src/evaluation-workflow";

function workflowEnvironment() {
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

describe("evaluation Workflow fan-out", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an independently retriable durable step for every case before one aggregation step", async () => {
    const prepared = {
      scenario: { id: "scenario-1", blueprint_id: "process-1", gate_threshold: 0.9 },
      releaseId: "release-1",
      modelProfile: "balanced",
      controls: [],
      prompt: { releaseId: "prompt-1" },
      cases: [
        { id: "case-a", name: "A", input_text: "A", assertions_json: "[]", weight: 1 },
        { id: "case-b", name: "B", input_text: "B", assertions_json: "[]", weight: 1 },
        { id: "case-c", name: "C", input_text: "C", assertions_json: "[]", weight: 1 }
      ]
    };
    vi.mocked(prepareEvaluationRun).mockResolvedValue(prepared as never);
    vi.mocked(evaluatePreparedCase).mockImplementation(async (_env, _tenant, runId, _prepared, item) => ({
      id: `${runId}:${item.id}`, caseId: item.id, name: item.name, status: "passing", passed: 1, total: 1,
      score: 1, output: "ok", model: "model", inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0,
      latencyMs: 1, evidence: [], error: null, weight: 1
    }));
    vi.mocked(persistEvaluationRun).mockResolvedValue({
      id: "run-1", status: "passing", score: 1
    } as never);
    const stepNames: string[] = [];
    const step = {
      async do<T>(name: string, optionsOrCallback: unknown, maybeCallback?: () => Promise<T>) {
        stepNames.push(name);
        const callback = typeof optionsOrCallback === "function"
          ? optionsOrCallback as () => Promise<T>
          : maybeCallback!;
        return callback();
      }
    };
    const { DB } = workflowEnvironment();
    const workflow = new EvaluationWorkflow() as EvaluationWorkflow & { env: unknown };
    workflow.env = { DB };
    const result = await workflow.run({ payload: {
      tenantId: "tenant-1", actorId: "actor-1", suiteId: "suite-1", scenarioId: "scenario-1",
      releaseId: "release-1", evaluationRunId: "run-1"
    } } as never, step as never);

    expect(prepareEvaluationRun).toHaveBeenCalledWith(expect.anything(), "tenant-1", "scenario-1", "release-1", undefined, 100);
    expect(stepNames.filter((name) => name.startsWith("evaluate case"))).toHaveLength(3);
    expect(new Set(stepNames).size).toBe(stepNames.length);
    expect(evaluatePreparedCase).toHaveBeenCalledTimes(3);
    expect(persistEvaluationRun).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ suiteId: "suite-1", evaluationRunId: "run-1", status: "passing", score: 1 });
  });
});
