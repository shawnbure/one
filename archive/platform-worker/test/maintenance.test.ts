import { describe, expect, it, vi } from "vitest";
import { emitMaintenanceDegradedAlerts, runScheduledMaintenance } from "../src/maintenance";

function fixture(failStart = false) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async all() {
          if (sql.includes("SELECT DISTINCT tenant_id")) return { results: [{ tenant_id: "tenant-1" }] };
          if (sql.includes("SELECT * FROM notification_policies")) return { results: [{
            id: "policy-1", channel: "in_app", severity: "critical", quiet_hours_enabled: 0,
            quiet_start_hour_utc: 22, quiet_end_hour_utc: 7, critical_bypass: 1
          }] };
          return { results: [] };
        },
        async run() {
          if (failStart && sql.includes("INSERT INTO platform_maintenance_runs")) throw new Error("ledger unavailable");
          writes.push({ sql, bindings });
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  return { env: { DB } as never, writes };
}

describe("scheduled maintenance evidence", () => {
  it("isolates task failures and persists one bounded degraded receipt", async () => {
    const { env, writes } = fixture();
    const healthy = vi.fn(async () => ({ processed: 2 }));
    const result = await runScheduledMaintenance(env, [
      { name: "healthy_task", run: healthy },
      { name: "failed_task", run: async () => { throw new Error(`Provider ${"a".repeat(32)} failed at https://secret.example/path`); } }
    ], new Date("2026-07-23T20:00:00.000Z"));
    expect(healthy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "degraded", taskCount: 2, failedCount: 1 });
    const update = writes.find(({ sql }) => sql.includes("UPDATE platform_maintenance_runs"));
    expect(update).toBeTruthy();
    expect(String(update?.bindings[3])).toContain("[redacted]");
    expect(String(update?.bindings[3])).toContain("[url]");
    expect(String(update?.bindings[3])).not.toContain("secret.example");
  });

  it("runs every control even when the evidence ledger cannot start", async () => {
    const { env } = fixture(true);
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const result = await runScheduledMaintenance(env, [
      { name: "first", run: first }, { name: "second", run: second }
    ]);
    expect(result.status).toBe("healthy");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("creates accountable alerts with control names but without internal task errors", async () => {
    const { env, writes } = fixture();
    const result = await runScheduledMaintenance(env, [
      { name: "retention_control", run: async () => { throw new Error("private database detail"); } }
    ]);
    const alerts = await emitMaintenanceDegradedAlerts(env, result);
    expect(alerts).toMatchObject({ tenants: 1, events: 1 });
    const event = writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO notification_events"));
    expect(JSON.stringify(event?.bindings)).toContain("retention_control");
    expect(JSON.stringify(event?.bindings)).not.toContain("private database detail");
  });
});
