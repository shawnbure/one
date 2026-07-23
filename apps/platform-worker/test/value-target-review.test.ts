import { describe, expect, it } from "vitest";
import { emitValueTargetReviewAlerts } from "../src/value-target-review";

function environment(candidates: Array<Record<string, unknown>>) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const queries: Array<{ sql: string; bindings: unknown[] }> = [];
  const emittedKeys = new Set<string>();
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async all() {
          queries.push({ sql, bindings });
          if (sql.includes("FROM process_value_targets")) return { results: candidates };
          if (sql.includes("FROM notification_policies")) return { results: [{
            id: "policy-1", channel: "in_app", severity: "warning",
            quiet_hours_enabled: 0, quiet_start_hour_utc: 22, quiet_end_hour_utc: 7,
            critical_bypass: 1, digest_mode: "immediate", digest_hour_utc: 8
          }] };
          return { results: [] };
        },
        async run() {
          writes.push({ sql, bindings });
          if (!sql.includes("INSERT OR IGNORE INTO notification_events")) {
            return { meta: { changes: 1 } };
          }
          const key = `${bindings[1]}:${bindings[2]}:${bindings[8]}`;
          if (emittedKeys.has(key)) return { meta: { changes: 0 } };
          emittedKeys.add(key);
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  return { env: { DB } as never, writes, queries };
}

describe("value target review reminders", () => {
  const now = new Date("2026-07-23T12:00:00.000Z");

  it("emits due-soon and overdue response tasks with bounded safe detail", async () => {
    const { env, writes, queries } = environment([
      { tenant_id: "tenant-1", blueprint_id: "process-soon", process_name: "Invoice intake",
        review_due_at: "2026-07-26T12:00:00.000Z", revision: 2 },
      { tenant_id: "tenant-1", blueprint_id: "process-overdue", process_name: "Renewal review",
        review_due_at: "2026-07-22T12:00:00.000Z", revision: 4 }
    ]);
    await expect(emitValueTargetReviewAlerts(env, now)).resolves.toEqual({
      scanned: 2, candidates: 2, events: 2, capped: false
    });
    const inserts = writes.filter(({ sql }) => sql.includes("INSERT OR IGNORE INTO notification_events"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.bindings).toEqual(expect.arrayContaining([
      "value.target_review_due", "Value target review due in 3 days · Invoice intake",
      "value_target", "process-soon:r2:due_soon"
    ]));
    expect(inserts[1]?.bindings).toEqual(expect.arrayContaining([
      "Value target review overdue · Renewal review", "process-overdue:r4:overdue"
    ]));
    const scan = queries.find(({ sql }) => sql.includes("FROM process_value_targets"));
    expect(scan?.sql).not.toContain("t.rationale");
    expect(scan?.sql).not.toContain("evidence_reference");
  });

  it("deduplicates each target revision and emits a new overdue stage", async () => {
    const candidate = { tenant_id: "tenant-1", blueprint_id: "process-1", process_name: "Intake",
      review_due_at: "2026-07-25T12:00:00.000Z", revision: 3 };
    const { env } = environment([candidate]);
    await expect(emitValueTargetReviewAlerts(env, now)).resolves.toMatchObject({ events: 1 });
    await expect(emitValueTargetReviewAlerts(env, now)).resolves.toMatchObject({ events: 0 });
    candidate.review_due_at = "2026-07-22T12:00:00.000Z";
    await expect(emitValueTargetReviewAlerts(env, now)).resolves.toMatchObject({ events: 1 });
  });

  it("uses a tenant-scoped indexed scan capped at 100 targets", async () => {
    const candidates = Array.from({ length: 100 }, (_, index) => ({
      tenant_id: "tenant-1", blueprint_id: `process-${index}`, process_name: `Process ${index}`,
      review_due_at: "2026-07-24T12:00:00.000Z", revision: 0
    }));
    const { env, queries } = environment(candidates);
    await expect(emitValueTargetReviewAlerts(env, now)).resolves.toMatchObject({
      scanned: 100, candidates: 100, events: 100, capped: true
    });
    const scan = queries.find(({ sql }) => sql.includes("FROM process_value_targets"));
    expect(scan?.sql).toContain("p.tenant_id=t.tenant_id");
    expect(scan?.sql).toContain("LIMIT 100");
    expect(scan?.bindings).toEqual(["2026-07-30T12:00:00.000Z"]);
  });
});
