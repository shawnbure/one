import { describe, expect, it } from "vitest";
import { updateValueTarget, ValueTargetConflict } from "../src/value-targets";

function environment(options: { process?: boolean; existing?: number | null; changes?: number } = {}) {
  const calls: Array<{ sql: string; bindings: unknown[]; ran: boolean }> = [];
  const DB = { prepare(sql: string) {
    const call = { sql, bindings: [] as unknown[], ran: false }; calls.push(call);
    const statement = {
      bind(...bindings: unknown[]) { call.bindings = bindings; return statement; },
      async all() { return { results: [] }; },
      async first() {
        if (sql.includes("SELECT b.id")) return options.process === false ? null : { id: "process-1" };
        if (sql.includes("SELECT revision")) return options.existing === null || options.existing === undefined
          ? null : { revision: options.existing };
        return null;
      },
      async run() { call.ran = true; return { meta: { changes: options.changes ?? 1 } }; }
    };
    return statement;
  }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    return Promise.all(statements.map((statement) => statement.run()));
  } };
  return { env: { DB } as never, calls };
}

const target = {
  targetItems: 500, targetHumanMinutesSaved: 1200, targetValue: 1500,
  maximumOverridePercent: 8, maximumFailurePercent: 5,
  reviewDueAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
  rationale: "Finance approved this operating target for the next review window.",
  evidenceReference: "operating-plan-2026-q3", expectedRevision: 0
};

describe("governed process value targets", () => {
  it("creates a bounded target for a same-tenant process and audits it", async () => {
    const state = environment();
    await expect(updateValueTarget(state.env, "tenant-a", "owner-1", "process-1", target))
      .resolves.toMatchObject({ blueprintId: "process-1", targetItems: 500, revision: 0 });
    const write = state.calls.find((call) => call.sql.includes("INSERT INTO process_value_targets"));
    expect(write?.bindings).toEqual(expect.arrayContaining(["tenant-a", "process-1", 500, 1200, 1500, "owner-1", 0]));
    expect(state.calls.some((call) => call.sql.includes("value.target_updated"))).toBe(true);
  });

  it("rejects a cross-tenant process before target persistence", async () => {
    const state = environment({ process: false });
    await expect(updateValueTarget(state.env, "tenant-a", "owner-1", "outside", target))
      .rejects.toThrow("same-tenant discovery baseline");
    expect(state.calls.some((call) => call.sql.includes("INSERT INTO process_value_targets"))).toBe(false);
  });

  it("uses optimistic revisions for target changes", async () => {
    const stale = environment({ existing: 3 });
    await expect(updateValueTarget(stale.env, "tenant-a", "owner-1", "process-1", target))
      .rejects.toBeInstanceOf(ValueTargetConflict);
    expect(stale.calls.some((call) => call.sql.includes("INSERT INTO process_value_targets"))).toBe(false);

    const current = environment({ existing: 3 });
    await expect(updateValueTarget(current.env, "tenant-a", "owner-1", "process-1",
      { ...target, expectedRevision: 3 })).resolves.toMatchObject({ revision: 4 });
  });
});
