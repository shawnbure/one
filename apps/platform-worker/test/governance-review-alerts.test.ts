import { describe, expect, it } from "vitest";
import { emitGovernanceReviewAlerts } from "../src/governance-review-alerts";

const candidate = {
  tenant_id: "tenant-1", review_key: "privacy_architecture",
  name: "Privacy and architecture", next_due_at: "2026-07-20 20:00:00",
};

function environment(options?: { claimed?: boolean; policies?: boolean }) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async all() {
          if (sql.includes("FROM tenant_governance_reviews")) return { results: [candidate] };
          if (sql.includes("SELECT * FROM notification_policies")) return {
            results: options?.policies === false ? [] : [{
              id: "policy-1", channel: "in_app", severity: "warning",
              quiet_hours_enabled: 0, quiet_start_hour_utc: 22, quiet_end_hour_utc: 7,
              critical_bypass: 0,
            }],
          };
          return { results: [] };
        },
        async run() {
          writes.push({ sql, bindings });
          if (sql.includes("INSERT OR IGNORE INTO governance_review_alert_receipts")) {
            return { meta: { changes: options?.claimed === false ? 0 : 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  return { env: { DB } as never, writes };
}

describe("governance review due alerts", () => {
  it("emits one metadata-only accountable overdue review event", async () => {
    const fixture = environment();
    await expect(emitGovernanceReviewAlerts(fixture.env, new Date("2026-07-23T20:00:00.000Z")))
      .resolves.toMatchObject({ considered: 1, emitted: 1, deduplicated: 0 });
    const claim = fixture.writes.find(({ sql }) => sql.includes("governance_review_alert_receipts"));
    expect(claim?.bindings).toEqual([
      "tenant-1", "privacy_architecture", "2026-07-20 20:00:00", "overdue",
    ]);
    const event = fixture.writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO notification_events"));
    expect(JSON.stringify(event?.bindings)).toContain("An owner or administrator");
    expect(JSON.stringify(event?.bindings)).not.toMatch(/prompt|credential|business payload/i);
  });

  it("deduplicates overlapping Cron invocations for the same due cycle and stage", async () => {
    const fixture = environment({ claimed: false });
    await expect(emitGovernanceReviewAlerts(fixture.env, new Date("2026-07-23T20:00:00.000Z")))
      .resolves.toMatchObject({ emitted: 0, deduplicated: 1 });
    expect(fixture.writes.some(({ sql }) => sql.includes("notification_events"))).toBe(false);
  });

  it("releases its claim when customer routing cannot create an event", async () => {
    const fixture = environment({ policies: false });
    await expect(emitGovernanceReviewAlerts(fixture.env, new Date("2026-07-23T20:00:00.000Z")))
      .resolves.toMatchObject({ emitted: 0, deduplicated: 0 });
    expect(fixture.writes.some(({ sql }) => sql.includes("DELETE FROM governance_review_alert_receipts"))).toBe(true);
  });
});
