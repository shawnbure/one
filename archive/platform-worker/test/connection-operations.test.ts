import { describe, expect, it } from "vitest";
import { markConnectionAttention, markConnectionSuccess, updateConnectionLifecycle } from "../src/connection-operations";

type Write = { sql: string; bindings: unknown[] };

function environment(member: Record<string, unknown> | null = {
  email: "owner@example.com"
}) {
  const writes: Write[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM connections")) return { id: "connection-1", name: "Customer CRM" };
          if (sql.includes("FROM tenant_members")) return member;
          return null;
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; },
        async all() { return { results: [] }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    }
  };
  return { env: { DB } as never, writes };
}

describe("connection lifecycle operations", () => {
  it("canonicalizes the rotation owner and records auditable lifecycle metadata", async () => {
    const { env, writes } = environment();
    const result = await updateConnectionLifecycle(env, "tenant-1", "actor-1", "connection-1", {
      credentialExpiresAt: "2027-01-15",
      rotationOwner: "MEMBER-1",
      lastRotatedAt: "2026-07-01"
    });
    expect(result).toMatchObject({ rotationOwner: "owner@example.com" });
    expect(result.credentialExpiresAt).toBe("2027-01-15T00:00:00.000Z");
    expect(writes.some(({ sql, bindings }) => sql.includes("expiry_alerted_at=NULL") &&
      bindings.includes("owner@example.com"))).toBe(true);
    expect(JSON.stringify(writes)).toContain("connection.lifecycle_updated");
  });

  it("rejects an ineligible or cross-tenant rotation owner before writing", async () => {
    const { env, writes } = environment(null);
    await expect(updateConnectionLifecycle(env, "tenant-1", "actor-1", "connection-1", {
      credentialExpiresAt: null, rotationOwner: "outside@example.com", lastRotatedAt: null
    })).rejects.toThrow("active administrator");
    expect(writes).toHaveLength(0);
  });

  it("keeps last successful use separate from an attention-only health check", async () => {
    const { env, writes } = environment();
    await markConnectionSuccess(env, "tenant-1", "connection-1", "Provider request succeeded.");
    await markConnectionAttention(env, "tenant-1", "connection-1", "Metadata exists; live probe unavailable.");
    expect(writes[0].sql).toContain("last_success_at=CURRENT_TIMESTAMP");
    expect(writes[1].sql).not.toContain("last_success_at");
    expect(writes[1].bindings).toContain("Metadata exists; live probe unavailable.");
  });
});
