import { describe, expect, it } from "vitest";
import { DelegationConflict, setApprovalDelegation } from "../src/approval-delegations";

type Write = { sql: string; bindings: unknown[] };

function environment(options?: { currentRevision?: number; cycle?: boolean; changes?: number }) {
  const writes: Write[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async all() {
          if (sql.includes("id IN")) return { results: [
            { id: "member-1", role: "owner", status: "active" },
            { id: "member-2", role: "reviewer", status: "active" }
          ] };
          return { results: [] };
        },
        async first() {
          if (sql.includes("SELECT 1 cycle")) return options?.cycle ? { cycle: 1 } : null;
          if (sql.includes("SELECT revision")) return options?.currentRevision
            ? { revision: options.currentRevision } : null;
          return null;
        },
        async run() {
          writes.push({ sql, bindings });
          return { meta: { changes: options?.changes ?? 1 } };
        }
      };
      return statement;
    }
  };
  return { env: { DB } as never, writes };
}

function validInput() {
  return {
    delegateId: "member-2",
    startsAt: new Date(Date.now() + 60_000).toISOString(),
    endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    reason: "Planned customer coverage",
    enabled: true
  };
}

describe("approval delegations", () => {
  it("creates a bounded tenant-scoped delegation and metadata-only audit", async () => {
    const { env, writes } = environment();
    const result = await setApprovalDelegation(env, "tenant-1", "member-1", "owner",
      "member-1", validInput());
    expect(result).toMatchObject({ memberId: "member-1", delegateId: "member-2", revision: 1 });
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO approval_delegations"))).toBe(true);
    const audit = writes.find(({ sql }) => sql.includes("INSERT INTO audit_events"));
    expect(audit?.sql).toContain("approval.delegation_updated");
    expect(JSON.stringify(audit)).not.toContain("Planned customer coverage");
  });

  it("prevents self-delegation and overlapping two-person cycles", async () => {
    const { env } = environment();
    await expect(setApprovalDelegation(env, "tenant-1", "member-1", "owner", "member-1",
      { ...validInput(), delegateId: "member-1" })).rejects.toThrow("different eligible");
    const cycle = environment({ cycle: true });
    await expect(setApprovalDelegation(cycle.env, "tenant-1", "member-1", "owner", "member-1",
      validInput())).rejects.toThrow("routing cycle");
  });

  it("protects another member's coverage and rejects stale edits", async () => {
    const { env } = environment();
    await expect(setApprovalDelegation(env, "tenant-1", "operator-1", "operator", "member-1",
      validInput())).rejects.toThrow("Only an owner");
    const stale = environment({ currentRevision: 3 });
    await expect(setApprovalDelegation(stale.env, "tenant-1", "member-1", "owner", "member-1",
      { ...validInput(), expectedRevision: 2 })).rejects.toBeInstanceOf(DelegationConflict);
  });
});
