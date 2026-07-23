import { describe, expect, it, vi } from "vitest";
import { getProviderAcceptance, runMicrosoftAcceptance } from "../src/provider-acceptance";

function environment(scopes = ["User.Read", "Mail.ReadBasic", "Calendars.ReadBasic"]) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("LEFT JOIN oauth_connections")) {
            return { id: "microsoft-1", status: "healthy", secret_configured: 1,
              account_email: "operator@example.com", scopes_json: JSON.stringify(scopes) };
          }
          if (sql.includes("JOIN oauth_connections")) {
            return { id: "microsoft-1", scopes_json: JSON.stringify(scopes) };
          }
          if (sql.includes("FROM provider_acceptance_runs")) return null;
          return null;
        },
        async run() {
          writes.push({ sql, bindings });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  return { env: { DB } as never, writes };
}

describe("Microsoft provider acceptance", () => {
  it("proves selected fixed read capabilities without storing provider content", async () => {
    const fixture = environment();
    const fetcher = vi.fn(async (_url: string | URL | Request) =>
      new Response(JSON.stringify({ value: [{ id: "provider-content-must-not-persist" }] }), {
        status: 200, headers: { "content-type": "application/json" }
      }));
    const tokenProvider = vi.fn(async () => ({
      accessToken: "secret-access-token", accountEmail: "operator@example.com",
      connectionId: "microsoft-1"
    }));
    const result = await runMicrosoftAcceptance(
      fixture.env, "tenant-1", "operator-1", ["mail", "calendar"],
      fetcher as never, tokenProvider as never
    );
    expect(result.status).toBe("passed");
    expect(result.results).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    const stored = JSON.stringify(fixture.writes);
    expect(stored).not.toContain("provider-content-must-not-persist");
    expect(stored).not.toContain("secret-access-token");
    expect(stored).toContain("Mail.ReadBasic");
  });

  it("records missing least-privilege consent as a failed capability without probing it", async () => {
    const fixture = environment(["User.Read"]);
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    const result = await runMicrosoftAcceptance(
      fixture.env, "tenant-1", "operator-1", ["mail"],
      fetcher as never, (async () => ({
        accessToken: "token", accountEmail: null, connectionId: "microsoft-1"
      })) as never
    );
    expect(result.status).toBe("failed");
    expect(result.results.find((item) => item.capability === "mail")).toMatchObject({
      status: "not_granted", scope: "Mail.ReadBasic"
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns only safe metadata from the latest acceptance run", async () => {
    const fixture = environment();
    const result = await getProviderAcceptance(fixture.env, "tenant-1");
    expect(result).toMatchObject({
      provider: "microsoft", connected: true,
      connection: { id: "microsoft-1", account: "operator@example.com" },
      latest: null
    });
  });
});
