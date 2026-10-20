import { describe, expect, it } from "vitest";
import { escalateOverdueApprovals } from "../src/approval-sla";

function environment(claimChanges = 1) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const overdue = [{
    id: "approval-1", tenant_id: "tenant-1", execution_id: "execution-1",
    title: "Review customer update", assigned_to: "owner@example.com",
    due_at: "2026-07-23T10:00:00.000Z"
  }];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async all() {
          return { results: sql.includes("FROM approvals") ? overdue : [] };
        },
        async run() {
          writes.push({ sql, bindings });
          return { meta: { changes: sql.includes("SET sla_escalated_at") ? claimChanges : 1 } };
        }
      };
      return statement;
    }
  };
  return { env: { DB } as never, writes };
}

describe("approval response SLA", () => {
  it("claims an overdue approval once and records metadata-only escalation evidence", async () => {
    const claimed = environment();
    await expect(escalateOverdueApprovals(claimed.env, new Date("2026-07-23T12:00:00Z")))
      .resolves.toEqual({ inspected: 1, escalated: 1 });
    expect(claimed.writes.some(({ sql }) => sql.includes("approval.sla_escalated"))).toBe(true);
    expect(JSON.stringify(claimed.writes)).not.toContain("Review customer update");

    const duplicate = environment(0);
    await expect(escalateOverdueApprovals(duplicate.env, new Date("2026-07-23T12:00:00Z")))
      .resolves.toEqual({ inspected: 1, escalated: 0 });
    expect(duplicate.writes.some(({ sql }) => sql.includes("approval.sla_escalated"))).toBe(false);
  });
});
