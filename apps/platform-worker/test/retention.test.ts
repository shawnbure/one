import { describe, expect, it } from "vitest";
import { enforceTenantRetention, previewRetention, updateRetentionControls } from "../src/retention";

type Write = { sql: string; bindings: unknown[] };

function environment(options?: { legalHold?: number; counts?: number }) {
  const writes: Write[] = [];
  const policy = {
    tenant_id: "tenant-1", conversation_days: 90, execution_days: 365, approval_days: 365,
    notification_days: 180, api_log_days: 90, legal_hold: options?.legalHold ?? 0
  };
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("SELECT * FROM tenant_retention_controls")) return policy;
          if (sql.includes("SELECT legal_hold")) return { legal_hold: policy.legal_hold };
          if (sql.includes("COUNT(")) return { count: options?.counts ?? 0 };
          return null;
        },
        async all() {
          if (sql.includes("SELECT DISTINCT e.instance_key")) return { results: [] };
          if (sql.includes("retention_enforcement_runs")) return { results: [] };
          return { results: [] };
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 2 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: { DB } as never, writes };
}

describe("tenant retention controls", () => {
  it("validates bounded periods and exact legal-hold release confirmation", async () => {
    const invalid = environment();
    await expect(updateRetentionControls(invalid.env, "tenant-1", "owner-1", {
      conversationDays: 0, executionDays: 365, approvalDays: 365, notificationDays: 180, apiLogDays: 90
    })).rejects.toThrow("Conversation retention");

    const held = environment({ legalHold: 1 });
    await expect(updateRetentionControls(held.env, "tenant-1", "owner-1", {
      conversationDays: 90, executionDays: 365, approvalDays: 365, notificationDays: 180, apiLogDays: 90,
      legalHold: false
    })).rejects.toThrow("exact confirmation");
  });

  it("previews eligible content without changing tenant data", async () => {
    const state = environment({ counts: 3 });
    await expect(previewRetention(state.env, "tenant-1", new Date("2026-07-23T00:00:00Z")))
      .resolves.toMatchObject({ legalHold: false, eligible: {
        executions: 3, approvals: 3, approvalMessages: 3, notifications: 3, apiLogs: 3, durableActors: 3
      } });
    expect(state.writes).toHaveLength(0);
  });

  it("honors legal hold and otherwise redacts content while preserving audit records", async () => {
    const held = environment({ legalHold: 1 });
    await expect(enforceTenantRetention(held.env, "tenant-1")).resolves
      .toEqual({ skipped: true, reason: "tenant_legal_hold" });
    expect(held.writes).toHaveLength(0);

    const active = environment();
    await expect(enforceTenantRetention(active.env, "tenant-1"))
      .resolves.toMatchObject({ skipped: false, evidence: { auditRetained: true } });
    expect(active.writes.some(({ sql }) => sql.includes("input_preview='[retention expired]'"))).toBe(true);
    expect(active.writes.some(({ sql }) => sql.includes("DELETE FROM api_logs"))).toBe(true);
    expect(active.writes.some(({ sql }) => sql.includes("UPDATE audit_events") || sql.includes("DELETE FROM audit_events"))).toBe(false);
    expect(JSON.stringify(active.writes)).toContain("retention.enforced");
  });
});
