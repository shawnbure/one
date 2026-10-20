import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverNotificationEmail, deliverNotificationWebhook, emitNotification, safeEmailDestination, safeWebhookDestination } from "../src/notifications";
import { encryptSecret } from "../src/oauth";

const deliveryRow = {
  id: "event-1",
  tenant_id: "tenant-1",
  event_type: "execution.failed",
  severity: "critical",
  title: "Execution failed",
  detail: "The upstream service was unavailable.",
  target_type: "execution",
  target_id: "execution-1",
  delivery_status: "pending",
  created_at: "2026-07-23T02:00:00.000Z",
  destination: "https://events.customer.example/workrr",
  channel: "webhook",
  secret_binding: "NOTIFICATION_WEBHOOK_SECRET"
};

function deliveryEnvironment(row: typeof deliveryRow | null = deliveryRow) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() { return row; },
        async all() { return { results: [] }; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    }
  };
  return { env: { DB, NOTIFICATION_WEBHOOK_SECRET: "delivery-secret" }, writes };
}

describe("signed notification delivery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only accepts public HTTPS destinations without embedded credentials or custom ports", () => {
    expect(safeWebhookDestination("https://customer.example/hooks#fragment")).toBe("https://customer.example/hooks");
    expect(() => safeWebhookDestination("http://customer.example/hooks")).toThrow("public HTTPS");
    expect(() => safeWebhookDestination("https://127.0.0.1/hooks")).toThrow("public HTTPS");
    expect(() => safeWebhookDestination("https://user:pass@customer.example/hooks")).toThrow("public HTTPS");
    expect(() => safeWebhookDestination("https://customer.example:8443/hooks")).toThrow("public HTTPS");
    expect(() => safeWebhookDestination("https://customer.example/hooks?token=secret")).toThrow("public HTTPS");
  });

  it("accepts one normalized email recipient and rejects header or recipient injection", () => {
    expect(safeEmailDestination(" Operations@Customer.Example ")).toBe("operations@customer.example");
    expect(() => safeEmailDestination("one@example.com,two@example.com")).toThrow("one valid recipient");
    expect(() => safeEmailDestination("ops@example.com\nBcc: bad@example.com")).toThrow("one valid recipient");
    expect(() => safeEmailDestination("not-an-email")).toThrow("one valid recipient");
  });

  it("signs a stable delivery envelope and records a successful attempt", async () => {
    let request: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      request = { url, init };
      return new Response(null, { status: 204 });
    }));
    const { env, writes } = deliveryEnvironment();
    await expect(deliverNotificationWebhook(env as never, "tenant-1", "event-1"))
      .resolves.toMatchObject({ delivered: true, status: 204 });
    expect(request?.url).toBe(deliveryRow.destination);
    const headers = new Headers(request?.init.headers);
    expect(headers.get("x-workrr-delivery")).toBe("event-1");
    expect(headers.get("x-workrr-signature")).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(request?.init.redirect).toBe("manual");
    expect(JSON.parse(String(request?.init.body))).toMatchObject({
      id: "event-1", type: "execution.failed", createdAt: deliveryRow.created_at
    });
    expect(writes.some((write) => write.sql.includes("delivery_status = 'delivered'") && write.bindings.includes("tenant-1"))).toBe(true);
  });

  it("does not send a delivered event twice", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env } = deliveryEnvironment({ ...deliveryRow, delivery_status: "delivered" });
    await expect(deliverNotificationWebhook(env as never, "tenant-1", "event-1"))
      .resolves.toMatchObject({ duplicate: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queues webhook channels while delivering in-app channels immediately", async () => {
    const jobs: unknown[] = [];
    const writes: string[] = [];
    const DB = {
      prepare(sql: string) {
        const statement = {
          bind() { return statement; },
          async all() { return { results: [
            { id: "in-app", channel: "in_app", severity: "warning" },
            { id: "webhook", channel: "webhook", severity: "critical" },
            { id: "email", channel: "email", severity: "critical" }
          ] }; },
          async run() { writes.push(sql); return { meta: { changes: 1 } }; }
        };
        return statement;
      }
    };
    const env = { DB, PROCESS_QUEUE: { async send(job: unknown) { jobs.push(job); } } };
    const ids = await emitNotification(env as never, "tenant-1", {
      eventType: "execution.failed", title: "Failed", detail: "Reason"
    });
    expect(ids).toHaveLength(3);
    expect(jobs).toEqual([
      expect.objectContaining({ kind: "notification_delivery", tenantId: "tenant-1" }),
      expect.objectContaining({ kind: "notification_delivery", tenantId: "tenant-1" }),
    ]);
    expect(writes.filter((sql) => sql.includes("INTO notification_events"))).toHaveLength(3);
    expect(writes.filter((sql) => sql.includes("delivery_queued_at"))).toHaveLength(2);
  });

  it("refreshes delegated Mail.Send and records Microsoft Graph acceptance", async () => {
    const encryptionKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64url");
    const encrypted = await encryptSecret(encryptionKey, "refresh-secret");
    const writes: Array<{ sql: string; bindings: unknown[] }> = [];
    const row = { ...deliveryRow, channel: "email", destination: "alerts@customer.example", secret_binding: null };
    const DB = {
      prepare(sql: string) {
        let bindings: unknown[] = [];
        const statement = {
          bind(...values: unknown[]) { bindings = values; return statement; },
          async first() {
            if (sql.includes("FROM notification_events")) return row;
            if (sql.includes("FROM oauth_connections")) return {
              id: "oauth-1", connection_id: "conn-1", account_email: "sender@customer.example", account_name: "Sender",
              scopes_json: '["offline_access","User.Read","Mail.Send"]',
              refresh_token_ciphertext: encrypted.ciphertext, refresh_token_iv: encrypted.iv,
            };
            return null;
          },
          async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; },
        };
        return statement;
      },
      async batch(statements: Array<{ run(): Promise<unknown> }>) {
        for (const statement of statements) await statement.run();
        return [];
      },
    };
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("/token")) return Response.json({
        access_token: "short-access", refresh_token: "rotated-refresh", expires_in: 3600,
        scope: "offline_access User.Read Mail.Send",
      });
      return new Response(null, { status: 202 });
    };
    const env = { DB, MICROSOFT_CLIENT_ID: "client", MICROSOFT_CLIENT_SECRET: "secret",
      OAUTH_TOKEN_ENCRYPTION_KEY: encryptionKey };
    await expect(deliverNotificationEmail(env as never, "tenant-1", "event-1", fetcher as typeof fetch))
      .resolves.toMatchObject({ delivered: true, status: 202 });
    const graph = requests.find((request) => request.url.endsWith("/me/sendMail"));
    expect(new Headers(graph?.init.headers).get("authorization")).toBe("Bearer short-access");
    expect(JSON.parse(String(graph?.init.body))).toMatchObject({
      message: { toRecipients: [{ emailAddress: { address: "alerts@customer.example" } }] },
      saveToSentItems: true,
    });
    expect(writes.some((write) => write.sql.includes("delivery_status = 'delivered'") &&
      write.bindings.includes("event-1"))).toBe(true);
    expect(JSON.stringify(writes)).not.toContain("rotated-refresh");
  });
});
