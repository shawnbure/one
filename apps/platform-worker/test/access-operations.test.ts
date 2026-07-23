import { describe, expect, it } from "vitest";
import { recordAccessSession, sessionEvidenceId, updateEmergencyAccessPlan } from "../src/access-operations";

function database(options: { planChanges?: number; member?: boolean } = {}) {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    calls,
    DB: {
      prepare(sql: string) {
        const call = { sql, bindings: [] as unknown[] };
        calls.push(call);
        const statement = {
          bind(...bindings: unknown[]) { call.bindings = bindings; return statement; },
          async run() {
            return { meta: { changes: sql.includes("emergency_access_events") ? (options.planChanges ?? 0) : 1 } };
          },
          async first() {
            if (sql.includes("SELECT id FROM tenant_members")) return options.member === false ? null : { id: "emergency-admin" };
            if (sql.includes("SELECT revision")) return null;
            return null;
          },
          async all() { return { results: [] }; }
        };
        return statement;
      }
    }
  };
}

describe("privacy-bounded Access operations", () => {
  it("hashes stable session evidence without exposing identity material", async () => {
    const first = await sessionEvidenceId(["tenant-a", "person@example.com", 123]);
    const second = await sessionEvidenceId(["tenant-a", "person@example.com", 123]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("person");
  });

  it("records a coarse client label and a fifteen-minute conditional heartbeat", async () => {
    const state = database();
    await recordAccessSession({ DB: state.DB } as never, new Request("https://one.example", { headers: {
      "user-agent": "Mozilla/5.0 (Macintosh) Chrome/126.0 sensitive-extra",
      "cf-ipcountry": "US", "cf-ray": "1234abcd-PHX", "cf-connecting-ip": "203.0.113.5"
    }}), { id: "member-1", tenant_id: "tenant-a", identity_type: "human" }, {
      sessionId: "hashed-session", identityType: "human", issuedAt: null, expiresAt: null
    });
    const write = state.calls[0];
    expect(write.sql).toContain("'-15 minutes'");
    expect(write.bindings).toContain("Chrome on macOS");
    expect(JSON.stringify(state.calls)).not.toContain("203.0.113.5");
    expect(JSON.stringify(state.calls)).not.toContain("sensitive-extra");
  });

  it("refuses to designate the configuring administrator as emergency access", async () => {
    const state = database();
    await expect(updateEmergencyAccessPlan({ DB: state.DB } as never, "tenant-a", "member-1", {
      memberId: "member-1", procedureSummary: "Recover Access through the separately controlled vault.",
      evidenceReference: "vault/item/42", reviewDueAt: new Date(Date.now() + 86_400_000).toISOString(),
      enabled: true, expectedRevision: 0
    })).rejects.toThrow("separate active administrator");
    expect(state.calls).toHaveLength(0);
  });
});
