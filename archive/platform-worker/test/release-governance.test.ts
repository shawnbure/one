import { describe, expect, it } from "vitest";
import { decideProcessRelease } from "../src/release-governance";

function environment(release: Record<string, unknown> | null, changes = 1) {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() { calls.push({ sql, bindings }); return release; },
        async run() { calls.push({ sql, bindings }); return { meta: { changes } }; }
      };
      return statement;
    }
  };
  return { env: { DB } as never, calls };
}

const draft = {
  id: "release-2", status: "draft", checksum: "checksum-2", created_by: "builder-1",
  version: 2, risk_level: "medium"
};

describe("immutable process release governance review", () => {
  it("records one exact-checksum owner decision inside the tenant and process boundary", async () => {
    const { env, calls } = environment(draft);
    const result = await decideProcessRelease(env, "tenant-a", "process-a", "release-2", "owner-1", {
      decision: "approved", evidence: "Reviewed regression evidence and approval-only rollout."
    });
    expect(result).toMatchObject({
      releaseId: "release-2", releaseChecksum: "checksum-2", decision: "approved", decidedBy: "owner-1"
    });
    expect(calls[0]?.bindings).toEqual(["release-2", "tenant-a", "process-a"]);
    expect(calls[0]?.sql).toContain("r.tenant_id=? AND r.blueprint_id=?");
    expect(calls[1]?.bindings.slice(1)).toEqual([
      "tenant-a", "process-a", "release-2", "checksum-2", "approved",
      "Reviewed regression evidence and approval-only rollout.", "owner-1"
    ]);
  });

  it("requires a different reviewer for high-risk approval", async () => {
    const { env, calls } = environment({ ...draft, risk_level: "high", created_by: "owner-1" });
    await expect(decideProcessRelease(env, "tenant-a", "process-a", "release-2", "owner-1", {
      decision: "approved", evidence: "I reviewed my own high-risk release evidence."
    })).rejects.toThrow("different owner or administrator");
    expect(calls.some((call) => call.sql.includes("INSERT OR IGNORE"))).toBe(false);
  });

  it("keeps decisions terminal and rejects releases outside the scoped tenant", async () => {
    await expect(decideProcessRelease(environment(draft, 0).env,
      "tenant-a", "process-a", "release-2", "owner-1", {
        decision: "rejected", evidence: "The evaluation does not cover the failure case."
      })).rejects.toThrow("already has a governance decision");
    await expect(decideProcessRelease(environment(null).env,
      "tenant-b", "process-a", "release-2", "owner-1", {
        decision: "approved", evidence: "Cross-tenant evidence must never be accepted."
      })).rejects.toThrow("not found");
  });
});

