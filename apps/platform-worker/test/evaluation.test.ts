import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEvaluationCase, redactSensitiveText, runEvaluation } from "../src/evaluation";
import { runModel } from "../src/model";

vi.mock("../src/model", () => ({ runModel: vi.fn() }));

const scenario = {
  id: "scenario-1", blueprint_id: "process-1", assertion_count: 7, gate_threshold: 1,
  active_release_id: "release-live", operating_mode: "assisted", prompt_release_id: "prompt-1"
};
const release = {
  id: "release-live", prompt_release_id: "prompt-1", model_profile: "balanced", version: 1,
  system_prompt: "Be concise", instructions_json: "[]", guardrails_json: '["Never invent access"]',
  checksum: "checksum", published_at: "2026-07-22T00:00:00Z"
};
const goldenCase = {
  id: "case-1", name: "Grounded answer", input_text: "What is this record?",
  assertions_json: JSON.stringify([
    { type: "contains_all", value: ["identifier"] },
    { type: "not_contains_any", value: ["I accessed your system"] },
    { type: "max_chars", value: 200 }
  ]),
  weight: 1
};

function evaluationEnvironment(options: { release?: typeof release | null; cases?: typeof goldenCase[] } = {}) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const selectedRelease = options.release === undefined ? release : options.release;
  const selectedCases = options.cases ?? [goldenCase];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first() {
          if (sql.includes("FROM evaluation_scenarios")) return scenario;
          if (sql.includes("FROM process_releases")) return selectedRelease;
          if (sql.includes("FROM model_catalog")) return { input_usd_per_million: 0.03, output_usd_per_million: 0.05 };
          return null;
        },
        async all() {
          if (sql.includes("FROM evaluation_cases")) return { results: selectedCases };
          return { results: [] };
        },
        async run() { writes.push({ sql, values }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    }
  };
  return { env: { DB } as never, writes };
}

describe("release-specific evaluation evidence", () => {
  beforeEach(() => vi.mocked(runModel).mockReset());

  it("fails evidence when a release does not belong to the scenario process", async () => {
    const { env, writes } = evaluationEnvironment({ release: null });
    const result = await runEvaluation(env, "tenant-1", "actor-1", "scenario-1", "release-from-another-process");
    expect(result.status).toBe("failing");
    expect(result.releaseId).toBe("release-from-another-process");
    expect(result.evidence.controls.find((item) => item.check === "release_belongs_to_process")?.passed).toBe(false);
    expect(runModel).not.toHaveBeenCalled();
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO evaluation_runs"))).toBe(true);
  });

  it("runs golden assertions against the exact release and captures usage", async () => {
    vi.mocked(runModel).mockResolvedValue({
      output: "Use the supplied identifier; ask an operator if it is missing.",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", inputTokens: 100, outputTokens: 20, totalTokens: 120
    });
    const { env, writes } = evaluationEnvironment();
    const result = await runEvaluation(env, "tenant-1", "actor-1", "scenario-1", "release-live");
    expect(result.status).toBe("passing");
    expect(result.score).toBe(1);
    expect(result.totalTokens).toBe(120);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
    expect(runModel).toHaveBeenCalledWith(expect.anything(), "balanced", expect.objectContaining({ releaseId: "prompt-1" }),
      goldenCase.input_text, "evaluation:release-live:balanced:case-1");
    expect(writes.some(({ sql, values }) => sql.includes("INSERT INTO evaluation_case_results") &&
      values.includes("release-live") && values.includes(120))).toBe(true);
  });

  it("fails a release when a prohibited output phrase appears", async () => {
    vi.mocked(runModel).mockResolvedValue({
      output: "I accessed your system and found the identifier.",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", inputTokens: 20, outputTokens: 10, totalTokens: 30
    });
    const { env } = evaluationEnvironment();
    const result = await runEvaluation(env, "tenant-1", "actor-1", "scenario-1", "release-live");
    expect(result.status).toBe("failing");
    expect(result.score).toBeLessThan(1);
    expect(result.evidence.cases[0]).toMatchObject({ status: "failing", passed: 2, total: 3 });
  });

  it("redacts common sensitive values before a case is persisted", () => {
    const result = redactSensitiveText("Email sam@example.com, SSN 123-45-6789, phone (602) 555-0100, card 4111 1111 1111 1111");
    expect(result.text).toContain("[REDACTED_EMAIL]");
    expect(result.text).toContain("[REDACTED_SSN]");
    expect(result.text).toContain("[REDACTED_PHONE]");
    expect(result.text).toContain("[REDACTED_PAYMENT_CARD]");
    expect(result).toMatchObject({ count: 4 });
    expect(result.text).not.toContain("sam@example.com");
  });

  it("stores customer-selected rubric dimensions and bounded weights", async () => {
    const { env, writes } = evaluationEnvironment({ cases: [] });
    const result = await createEvaluationCase(env, "tenant-1", "scenario-1", {
      name: "Grounded safety response",
      input: "Use the supplied record",
      expectedPhrases: ["record"],
      prohibitedPhrases: ["invented"],
      format: "text",
      maxChars: 500,
      dimension: "completeness",
      assertionWeight: 2.5,
      caseWeight: 3
    });
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "contains_all", dimension: "completeness", weight: 2.5 }),
      expect.objectContaining({ type: "not_contains_any", dimension: "safety", weight: 2.5 }),
      expect.objectContaining({ type: "max_chars", dimension: "clarity", weight: 2.5 })
    ]));
    expect(writes.some(({ sql, values }) => sql.includes("INSERT INTO evaluation_cases") && values.includes(3))).toBe(true);
  });
});
