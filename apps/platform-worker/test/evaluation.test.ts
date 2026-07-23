import { describe, expect, it } from "vitest";
import { runEvaluation } from "../src/evaluation";

describe("release-specific evaluation evidence", () => {
  it("fails evidence when a release does not belong to the scenario process", async () => {
    const writes: string[] = [];
    const DB = {
      prepare(sql: string) {
        const statement = {
          bind(..._values: unknown[]) { return statement; },
          async first() {
            if (sql.includes("FROM evaluation_scenarios")) return { id: "scenario-1", blueprint_id: "process-1", assertion_count: 4, active_release_id: "release-live" };
            if (sql.includes("FROM process_releases")) return null;
            return null;
          },
          async run() { writes.push(sql); return { meta: { changes: 1 } }; }
        };
        return statement;
      },
      async batch(statements: Array<{ run(): Promise<unknown> }>) { for (const statement of statements) await statement.run(); return []; }
    };
    const result = await runEvaluation({ DB } as never, "tenant-1", "actor-1", "scenario-1", "release-from-another-process");
    expect(result.status).toBe("failing");
    expect(result.releaseId).toBe("release-from-another-process");
    expect(result.evidence.find((item) => item.check === "release_belongs_to_process")?.passed).toBe(false);
    expect(writes.some((sql) => sql.includes("INSERT INTO evaluation_runs"))).toBe(true);
  });
});
