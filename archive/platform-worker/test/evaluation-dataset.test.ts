import { describe, expect, it } from "vitest";
import { exportEvaluationDataset, importEvaluationDataset } from "../src/evaluation";

function datasetEnvironment(options: {
  existingNames?: string[];
  exportCases?: Array<Record<string, unknown>>;
} = {}) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first() {
          if (sql.includes("FROM evaluation_scenarios")) return {
            id: "scenario-1", blueprint_id: "process-1", name: "Routing quality",
            category: "routing", gate_threshold: 0.9
          };
          return null;
        },
        async all() {
          if (sql.includes("FROM dlp_rules")) return { results: [] };
          if (sql.includes("SELECT name, input_text")) return { results: options.exportCases ?? [] };
          if (sql.includes("SELECT name, assertions_json FROM evaluation_cases")) {
            return { results: (options.existingNames ?? []).map((name) => ({ name, assertions_json: "[]" })) };
          }
          if (sql.includes("SELECT assertions_json FROM evaluation_cases")) return { results: [] };
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

const portableCase = {
  name: "Grounded response",
  input: "Contact pat@example.com with the supplied facts",
  assertions: [
    { type: "contains_all", value: ["facts"], dimension: "groundedness", weight: 2 },
    { type: "not_contains_any", value: ["invented"], dimension: "safety", weight: 3 }
  ],
  weight: 2,
  enabled: true
};

describe("portable evaluation datasets", () => {
  it("exports only the tenant-scoped scenario and its validated rubric cases", async () => {
    const { env } = datasetEnvironment({ exportCases: [{
      name: portableCase.name,
      input_text: "[REDACTED_EMAIL]",
      assertions_json: JSON.stringify(portableCase.assertions),
      weight: 2,
      enabled: 1
    }] });
    const result = await exportEvaluationDataset(env, "tenant-1", "scenario-1");
    expect(result).toMatchObject({
      schema: "workrr-evaluation/v1",
      scenario: { name: "Routing quality", gateThreshold: 0.9 }
    });
    expect(result.scenario.cases[0]).toMatchObject({
      name: portableCase.name,
      input: "[REDACTED_EMAIL]",
      weight: 2,
      enabled: true
    });
  });

  it("merges idempotently and stores only the DLP-safe imported input", async () => {
    const { env, writes } = datasetEnvironment();
    const result = await importEvaluationDataset(env, "tenant-1", "scenario-1", {
      schema: "workrr-evaluation/v1",
      scenario: { gateThreshold: 0.85, cases: [portableCase] }
    });
    expect(result).toMatchObject({ imported: 1, skipped: 0, gateThreshold: 0.85, totalCases: 1 });
    const insert = writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO evaluation_cases"));
    expect(insert?.values.some((value) => typeof value === "string" && value.includes("[REDACTED_EMAIL]"))).toBe(true);
    expect(insert?.values.join(" ")).not.toContain("pat@example.com");
    expect(writes.some(({ sql, values }) => sql.includes("UPDATE evaluation_scenarios") && values.includes(0.85))).toBe(true);
  });

  it("skips a case name that already exists instead of duplicating it", async () => {
    const { env, writes } = datasetEnvironment({ existingNames: [portableCase.name] });
    const result = await importEvaluationDataset(env, "tenant-1", "scenario-1", {
      schema: "workrr-evaluation/v1",
      scenario: { gateThreshold: 0.9, cases: [portableCase] }
    });
    expect(result).toMatchObject({ imported: 0, skipped: 1, totalCases: 1 });
    expect(writes.some(({ sql }) => sql.includes("INSERT OR IGNORE INTO evaluation_cases"))).toBe(false);
  });

  it("blocks an imported dataset before persistence when tenant DLP requires it", async () => {
    const { env, writes } = datasetEnvironment();
    await expect(importEvaluationDataset(env, "tenant-1", "scenario-1", {
      schema: "workrr-evaluation/v1",
      scenario: { gateThreshold: 0.9, cases: [{ ...portableCase, input: "SSN 123-45-6789" }] }
    })).rejects.toThrow("DLP policy blocked");
    expect(writes.some(({ sql }) => sql.includes("INSERT OR IGNORE INTO evaluation_cases"))).toBe(false);
  });
});
