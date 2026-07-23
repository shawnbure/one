import { describe, expect, it } from "vitest";
import type { ToolPolicy } from "@workrr/contracts";
import { encryptSecret } from "../src/oauth";
import { invokeApprovedBoundAdapter, invokeBoundAdapter } from "../src/tool-adapters";

const encryptionKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64url");
const policy: ToolPolicy = {
  id: "tool-ms-profile",
  name: "get_my_microsoft_profile",
  version: 1,
  adapterKind: "microsoft",
  handlerKey: "microsoft.profile.get",
  accessMode: "read",
  riskLevel: "low",
  connectionId: "conn-ms",
  connectionReady: true,
  dataClassification: "internal",
  rateLimitPerMinute: 30,
  inputSchemaJson: '{"type":"object","additionalProperties":false}',
  outputSchemaJson: '{"type":"object"}'
};

async function environment() {
  const encrypted = await encryptSecret(encryptionKey, "refresh-token");
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM oauth_connections")) return {
            id: "oauth-ms", connection_id: "conn-ms", account_email: null, account_name: "Operator",
            scopes_json: '["openid","offline_access","User.Read","Calendars.ReadWrite"]',
            refresh_token_ciphertext: encrypted.ciphertext, refresh_token_iv: encrypted.iv
          };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    }
  };
  return { env: {
    DB, MICROSOFT_CLIENT_ID: "client", MICROSOFT_CLIENT_SECRET: "secret",
    OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey
  } as never, writes };
}

describe("bound Microsoft tool adapters", () => {
  it("uses the fixed Graph profile endpoint and returns DLP-protected bounded data", async () => {
    const { env, writes } = await environment();
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.includes("/oauth2/v2.0/token")) return Response.json({
        access_token: "short-access", expires_in: 3600, scope: "openid offline_access User.Read"
      });
      return Response.json({ id: "user-1", displayName: "Operations User" });
    };
    const result = await invokeBoundAdapter(env, "tenant-1", "execution-1", policy, {}, fetcher as typeof fetch);
    expect(result.modelOutput).toMatchObject({
      status: "completed", adapter: "microsoft.profile.get",
      data: { id: "user-1", displayName: "Operations User" }
    });
    expect(calls[1]?.url).toBe("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName");
    expect(calls[1]?.authorization).toBe("Bearer short-access");
    expect(JSON.stringify(writes)).not.toContain("short-access");
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO api_logs"))).toBe(true);
  });

  it("rejects unregistered and mismatched adapters before network access", async () => {
    const { env } = await environment();
    let calls = 0;
    await expect(invokeBoundAdapter(env, "tenant-1", "execution-1",
      { ...policy, handlerKey: "http.generic" }, {}, (async () => {
        calls += 1; return new Response();
      }) as typeof fetch)).rejects.toThrow("No registered adapter");
    expect(calls).toBe(0);
  });

  it("creates an approved calendar event through the fixed endpoint with provider idempotency", async () => {
    const { env, writes } = await environment();
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token")) return Response.json({
        access_token: "calendar-access", expires_in: 3600, scope: "Calendars.ReadWrite"
      });
      calls.push({ url, method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null });
      return Response.json({ id: "event-42", subject: "Customer review", webLink: "https://outlook/event-42" },
        { status: 201 });
    };
    const writePolicy: ToolPolicy = {
      ...policy, id: "tool-calendar-create", name: "create_microsoft_calendar_event",
      handlerKey: "microsoft.calendar.event.create", accessMode: "write", riskLevel: "medium"
    };
    const result = await invokeApprovedBoundAdapter(env, "tenant-1", "execution-1", writePolicy, {
      subject: "Customer review", start: "2026-08-01T16:00:00Z", end: "2026-08-01T16:30:00Z",
      timeZone: "UTC", location: "Online", body: "Review the proposal"
    }, "immutable-invocation-key", fetcher as typeof fetch);
    expect(result.providerResourceId).toBe("event-42");
    expect(calls[0]).toMatchObject({
      url: "https://graph.microsoft.com/v1.0/me/events", method: "POST"
    });
    expect(calls[0]?.body).toMatchObject({
      subject: "Customer review", transactionId: "immutable-invocation-key"
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("attendees");
    expect(JSON.stringify(writes)).not.toContain("calendar-access");
  });

  it("rejects invalid calendar bounds before requesting a token", async () => {
    const { env } = await environment();
    let calls = 0;
    const writePolicy: ToolPolicy = {
      ...policy, handlerKey: "microsoft.calendar.event.create", accessMode: "write", riskLevel: "medium"
    };
    await expect(invokeApprovedBoundAdapter(env, "tenant-1", "execution-1", writePolicy, {
      subject: "Invalid", start: "2026-08-01T17:00:00Z", end: "2026-08-01T16:00:00Z"
    }, "key", (async () => { calls += 1; return new Response(); }) as typeof fetch))
      .rejects.toThrow("end after start");
    expect(calls).toBe(0);
  });
});
