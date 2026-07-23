import { describe, expect, it } from "vitest";
import { recordValueMeasurement, voidValueMeasurement } from "../src/value-evidence";

function environment(options: { baseline?: Record<string, unknown> | null; changes?: number } = {}) {
  const calls: Array<{ sql: string; bindings: unknown[]; ran: boolean }> = [];
  const DB = {
    prepare(sql: string) {
      const call = { sql, bindings: [] as unknown[], ran: false }; calls.push(call);
      const statement = {
        bind(...bindings: unknown[]) { call.bindings = bindings; return statement; },
        async first() {
          if (sql.includes("FROM process_discovery")) return options.baseline === undefined
            ? { minutes_per_item: 12, hourly_cost: 45, name: "Invoice review" } : options.baseline;
          return null;
        },
        async all() { return { results: [] }; },
        async run() { call.ran = true; return { meta: { changes: options.changes ?? 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: { DB } as never, calls };
}

const measurement = {
  blueprintId: "process-1", periodStart: "2026-07-01", periodEnd: "2026-07-20",
  itemsProcessed: 100, actualHumanMinutes: 300, averageCycleMinutes: 6,
  overrideCount: 4, failureCount: 2, evidenceReference: "finance-report-2026-07",
  note: "Validated with the finance operations owner."
};

describe("governed business value evidence", () => {
  it("calculates saved effort and value from the customer-approved discovery baseline", async () => {
    const state = environment();
    const result = await recordValueMeasurement(state.env, "tenant-a", "operator-1", measurement);
    expect(result).toMatchObject({ processName: "Invoice review", humanMinutesSaved: 900, estimatedValue: 675, status: "active" });
    const insert = state.calls.find((call) => call.sql.includes("INSERT INTO business_value_measurements"));
    expect(insert?.bindings).toEqual(expect.arrayContaining(["tenant-a", "process-1", 100, 300, 900, 675, "operator-1"]));
    expect(state.calls.some((call) => call.sql.includes("value.measurement_recorded"))).toBe(true);
  });

  it("requires a same-tenant discovery baseline and writes nothing when it is absent", async () => {
    const state = environment({ baseline: null });
    await expect(recordValueMeasurement(state.env, "tenant-a", "operator-1", measurement))
      .rejects.toThrow("same-tenant discovery baseline");
    expect(state.calls.some((call) => call.sql.includes("INSERT INTO business_value_measurements"))).toBe(false);
  });

  it("rejects impossible counts and unbounded evidence periods", async () => {
    const state = environment();
    await expect(recordValueMeasurement(state.env, "tenant-a", "operator-1",
      { ...measurement, overrideCount: 101 })).rejects.toThrow("Whole-number value");
    await expect(recordValueMeasurement(state.env, "tenant-a", "operator-1",
      { ...measurement, periodStart: "2024-01-01" })).rejects.toThrow("valid evidence period");
    expect(state.calls).toHaveLength(0);
  });

  it("voids rather than deletes corrected evidence with tenant and revision guards", async () => {
    const state = environment();
    await expect(voidValueMeasurement(state.env, "tenant-a", "owner-1", "value-1",
      "The imported report covered the wrong period.", 2)).resolves.toEqual({ id: "value-1", status: "void" });
    const update = state.calls.find((call) => call.sql.includes("UPDATE business_value_measurements"));
    expect(update?.bindings).toEqual(expect.arrayContaining(["owner-1", "value-1", "tenant-a", 2]));
    expect(update?.sql).toContain("status='active'");
    expect(state.calls.some((call) => call.sql.includes("value.measurement_voided"))).toBe(true);
  });
});
