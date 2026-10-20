import { describe, expect, it } from "vitest";
import { completeMicrosoftOAuth, decryptSecret, encryptSecret, getMicrosoftAccessToken, startMicrosoftOAuth } from "../src/oauth";

const encryptionKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64url");
const secrets = {
  MICROSOFT_CLIENT_ID: "11111111-1111-1111-1111-111111111111",
  MICROSOFT_CLIENT_SECRET: "client-secret-value",
  OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey,
  APP_DOMAIN: "one-dev.workrr.ai"
};

describe("Microsoft OAuth lifecycle", () => {
  it("encrypts sensitive values with authenticated encryption", async () => {
    const encrypted = await encryptSecret(encryptionKey, "refresh-token-secret");
    expect(encrypted.ciphertext).not.toContain("refresh-token-secret");
    expect(encrypted.iv).not.toHaveLength(0);
    await expect(decryptSecret(encryptionKey, encrypted.ciphertext, encrypted.iv)).resolves.toBe("refresh-token-secret");
    const tampered = Buffer.from(encrypted.ciphertext, "base64url");
    tampered[0] = tampered[0]! ^ 1;
    await expect(decryptSecret(encryptionKey, tampered.toString("base64url"), encrypted.iv)).rejects.toThrow();
  });

  it("creates a short-lived PKCE request with only selected capability scopes", async () => {
    let insert: unknown[] = [];
    const env = { ...secrets, DB: { prepare(sql: string) {
      const statement = {
        bind(...values: unknown[]) { insert = values; return statement; },
        async run() { expect(sql).toContain("INSERT INTO oauth_states"); return { meta: { changes: 1 } }; }
      };
      return statement;
    } } };
    const result = await startMicrosoftOAuth(env as never, "tenant-1", "member-1", ["mail", "mail", "unknown"]);
    const authorization = new URL(result.authorizationUrl);
    expect(authorization.hostname).toBe("login.microsoftonline.com");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("scope")).toContain("Mail.ReadBasic");
    expect(authorization.searchParams.get("scope")).not.toContain("Files.Read");
    expect(result.capabilities).toEqual(["mail"]);
    expect(insert[1]).toBe("tenant-1");
    expect(insert[2]).toBe("member-1");
    expect(insert.join(" ")).not.toContain(authorization.searchParams.get("state")!);
    expect(insert.join(" ")).not.toContain("client-secret-value");
  });

  it("requests Mail.Send only when notification delivery is explicitly selected", async () => {
    const env = { ...secrets, DB: { prepare() {
      return { bind() { return this; }, async run() { return { meta: { changes: 1 } }; } };
    } } };
    const result = await startMicrosoftOAuth(env as never, "tenant-1", "member-1", ["mail_send"]);
    expect(result.scopes).toContain("Mail.Send");
    expect(result.scopes).not.toContain("Mail.ReadBasic");
  });

  it("claims state once before exchanging the authorization code", async () => {
    const verifier = await encryptSecret(encryptionKey, "pkce-verifier");
    let fetchCalls = 0;
    const env = { ...secrets, DB: { prepare(sql: string) {
      const statement = {
        bind() { return statement; },
        async first() {
          if (sql.includes("FROM oauth_states")) return {
            tenant_id: "tenant-1", actor_id: "member-1", verifier_ciphertext: verifier.ciphertext,
            verifier_iv: verifier.iv, capabilities_json: '["mail"]',
            redirect_uri: "https://one-dev.workrr.ai/oauth/microsoft/callback"
          };
          return null;
        },
        async run() { return { meta: { changes: 0 } }; }
      };
      return statement;
    } } };
    await expect(completeMicrosoftOAuth(env as never, "state", "code", async () => {
      fetchCalls += 1;
      return new Response();
    })).rejects.toThrow("already used");
    expect(fetchCalls).toBe(0);
  });

  it("persists only encrypted refresh-token material after a verified profile check", async () => {
    const verifier = await encryptSecret(encryptionKey, "pkce-verifier");
    const writes: Array<{ sql: string; bindings: unknown[] }> = [];
    const env = { ...secrets, DB: {
      prepare(sql: string) {
        let bindings: unknown[] = [];
        const statement = {
          sql,
          bind(...values: unknown[]) { bindings = values; return statement; },
          async first() {
            if (sql.includes("FROM oauth_states")) return {
              tenant_id: "tenant-1", actor_id: "member-1", verifier_ciphertext: verifier.ciphertext,
              verifier_iv: verifier.iv, capabilities_json: '["mail"]',
              redirect_uri: "https://one-dev.workrr.ai/oauth/microsoft/callback"
            };
            if (sql.includes("FROM connections")) return { id: "conn-microsoft" };
            return null;
          },
          async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
        };
        return statement;
      },
      async batch(statements: Array<{ run(): Promise<unknown> }>) {
        for (const statement of statements) await statement.run();
        return [];
      }
    } };
    let call = 0;
    const fetcher = async () => {
      call += 1;
      if (call === 1) return Response.json({
        access_token: "short-lived-access", refresh_token: "rotating-refresh-secret",
        expires_in: 3600, scope: "openid offline_access User.Read Mail.ReadBasic"
      });
      return Response.json({ id: "graph-user-1", displayName: "Operations User", mail: "ops@example.com" });
    };
    const result = await completeMicrosoftOAuth(env as never, "state", "code", fetcher as typeof fetch);
    expect(result).toMatchObject({ tenantId: "tenant-1", connectionId: "conn-microsoft", accountEmail: "ops@example.com" });
    const oauthWrite = writes.find((item) => item.sql.includes("INSERT INTO oauth_connections"));
    expect(oauthWrite).toBeDefined();
    expect(JSON.stringify(writes)).not.toContain("rotating-refresh-secret");
    await expect(decryptSecret(encryptionKey, String(oauthWrite!.bindings[7]), String(oauthWrite!.bindings[8])))
      .resolves.toBe("rotating-refresh-secret");
  });

  it("rejects malformed encryption keys before writing OAuth state", async () => {
    let writes = 0;
    const env = { ...secrets, OAUTH_TOKEN_ENCRYPTION_KEY: "too-short", DB: { prepare() {
      return { bind() { return this; }, async run() { writes += 1; return { meta: { changes: 1 } }; } };
    } } };
    await expect(startMicrosoftOAuth(env as never, "tenant-1", "member-1", ["mail"]))
      .rejects.toThrow("must be 32 bytes");
    expect(writes).toBe(0);
  });

  it("refreshes a scoped access token and rotates refresh material without exposing it", async () => {
    const encrypted = await encryptSecret(encryptionKey, "old-refresh");
    const writes: Array<{ sql: string; bindings: unknown[] }> = [];
    const env = { ...secrets, DB: {
      prepare(sql: string) {
        let bindings: unknown[] = [];
        const statement = {
          bind(...values: unknown[]) { bindings = values; return statement; },
          async first() { return {
            id: "oauth-1", connection_id: "conn-1", account_email: "ops@example.com", account_name: "Ops",
            scopes_json: '["openid","offline_access","Mail.Send"]',
            refresh_token_ciphertext: encrypted.ciphertext, refresh_token_iv: encrypted.iv,
          }; },
          async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; },
        };
        return statement;
      },
      async batch(statements: Array<{ run(): Promise<unknown> }>) {
        for (const statement of statements) await statement.run();
        return [];
      },
    } };
    const result = await getMicrosoftAccessToken(env as never, "tenant-1", "Mail.Send", async () =>
      Response.json({ access_token: "short-access", refresh_token: "new-refresh", expires_in: 3600,
        scope: "openid offline_access Mail.Send" })) ;
    expect(result).toMatchObject({ accessToken: "short-access", accountEmail: "ops@example.com" });
    expect(JSON.stringify(writes)).not.toContain("new-refresh");
    const oauthWrite = writes.find((write) => write.sql.includes("UPDATE oauth_connections SET status='connected'"));
    await expect(decryptSecret(encryptionKey, String(oauthWrite?.bindings[1]), String(oauthWrite?.bindings[2])))
      .resolves.toBe("new-refresh");
  });
});
