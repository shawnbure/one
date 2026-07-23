import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverNotificationWebhook, emitNotification, safeWebhookDestination } from "../src/notifications";

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
            { id: "webhook", channel: "webhook", severity: "critical" }
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
    expect(ids).toHaveLength(2);
    expect(jobs).toEqual([expect.objectContaining({ kind: "notification_delivery", tenantId: "tenant-1" })]);
    expect(writes).toHaveLength(2);
  });
});
