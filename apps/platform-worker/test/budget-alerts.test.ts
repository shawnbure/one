import { describe, expect, it } from "vitest";
import { emitBudgetThresholdAlerts } from "../src/budget-alerts";

const candidate = {
  tenant_id: "tenant-1", scope_type: "process" as const, scope_id: "process-1",
  scope_name: "Customer triage", monthly_limit_usd: 5, warning_percent: 80,
  hard_limit: 1, spent: 5.2
};

function environment(options?: { claimed?: boolean; policies?: boolean }) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async all() {
          if (sql.includes("WITH") && sql.includes("tenant_spend")) return { results: [candidate] };
          if (sql.includes("SELECT * FROM notification_policies")) return {
            results: options?.policies === false ? [] : [{
              id: "policy-1", channel: "in_app", severity: "warning",
              quiet_hours_enabled: 0, quiet_start_hour_utc: 22, quiet_end_hour_utc: 7,
              critical_bypass: 0
            }]
          };
          return { results: [] };
        },
        async run() {
          writes.push({ sql, bindings });
          if (sql.includes("INSERT OR IGNORE INTO budget_threshold_alert_receipts")) {
            return { meta: { changes: options?.claimed === false ? 0 : 1 } };
          }
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  return { env: { DB } as never, writes };
}

describe("monthly budget threshold alerts", () => {
  it("claims and emits one accountable hard-limit event without business payloads", async () => {
    const state = environment();
    await expect(emitBudgetThresholdAlerts(state.env, new Date("2026-07-23T20:00:00.000Z")))
      .resolves.toMatchObject({ considered: 1, emitted: 1, deduplicated: 0, periodMonth: "2026-07" });
    const claim = state.writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO budget_threshold_alert_receipts"));
    expect(claim?.bindings).toEqual(["tenant-1", "process", "process-1", "2026-07", "hard_limit"]);
    const event = state.writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO notification_events"));
    expect(JSON.stringify(event?.bindings)).toContain("New model calls in this scope are blocked");
    expect(JSON.stringify(event?.bindings)).not.toContain("prompt");
  });

  it("deduplicates overlapping hourly invocations through the monthly receipt", async () => {
    const state = environment({ claimed: false });
    await expect(emitBudgetThresholdAlerts(state.env, new Date("2026-07-23T20:00:00.000Z")))
      .resolves.toMatchObject({ emitted: 0, deduplicated: 1 });
    expect(state.writes.some(({ sql }) => sql.includes("notification_events"))).toBe(false);
  });

  it("releases a claim when no delivery policy can create an event", async () => {
    const state = environment({ policies: false });
    await expect(emitBudgetThresholdAlerts(state.env, new Date("2026-07-23T20:00:00.000Z")))
      .resolves.toMatchObject({ emitted: 0, deduplicated: 0 });
    expect(state.writes.some(({ sql }) => sql.includes("DELETE FROM budget_threshold_alert_receipts"))).toBe(true);
  });
});
