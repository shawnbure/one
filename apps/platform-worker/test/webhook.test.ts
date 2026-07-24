import { describe, expect, it } from "vitest";
import { app } from "../src/index";

const secret = "test-webhook-secret";
const endpoint = { id: "inbox-intake", tenant_id: "tenant-1", blueprint_id: "inbox-triage", secret_binding: "WEBHOOK_INBOX_SECRET",
  status: "active", accepted_events_json: '["request.created"]' };

function webhookEnvironment(rules: unknown[] = []) {
  let receipt: { execution_id: string } | null = null;
  const jobs: unknown[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM webhook_endpoints")) return endpoint;
          if (sql.includes("FROM webhook_receipts")) return receipt;
          if (sql.includes("FROM agent_blueprints")) return {
            id: "inbox-triage", tenant_id: "tenant-1", name: "Inbox Triage", description: "Triage",
            execution_profile: "instant", model_profile: "fast", prompt_release_id: "prompt-1", autonomy: "suggest",
            status: "active", tools_json: "[]", updated_at: "now", operating_mode: "active"
          };
          if (sql.includes("tenant_operating_controls")) return { mode: "active" };
          return null;
        },
        async all() { return { results: sql.includes("custom_dlp_entries") ? [] : rules }; },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO webhook_receipts")) {
            if (receipt) return { meta: { changes: 0 } };
            receipt = { execution_id: String(bindings[5]) };
          }
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    },
    async batch() { return []; }
  };
  return { env: { DB, WEBHOOK_INBOX_SECRET: secret,
    OAUTH_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    PROCESS_QUEUE: { async send(job: unknown) { jobs.push(job); } } }, jobs };
}

async function signature(body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function deliver(env: unknown, body: string, eventId: string, providedSignature?: string) {
  return app.fetch(new Request("http://localhost/webhooks/inbox-intake", { method: "POST", headers: {
    "content-type": "application/json", "idempotency-key": eventId, "x-workrr-signature": providedSignature ?? await signature(body)
  }, body }), env as never);
}

describe("signed webhook intake", () => {
  it("rejects an invalid signature before queue delivery", async () => {
    const { env, jobs } = webhookEnvironment();
    const response = await deliver(env, '{"event":"request.created","input":"hello"}', "event-1", "sha256=invalid");
    expect(response.status).toBe(401);
    expect(jobs).toHaveLength(0);
  });

  it("accepts a signed event and preserves tenant context in the Queue job", async () => {
    const { env, jobs } = webhookEnvironment();
    const response = await deliver(env, '{"event":"request.created","input":"hello"}', "event-2");
    expect(response.status).toBe(202);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ tenantId: "tenant-1", blueprintId: "inbox-triage",
      idempotencyKey: "webhook:inbox-intake:event-2" });
  });

  it("returns the original execution for a duplicate without queuing twice", async () => {
    const { env, jobs } = webhookEnvironment();
    const body = '{"event":"request.created","input":"hello"}';
    const first = await deliver(env, body, "event-3");
    const firstPayload = await first.json() as { executionId: string };
    const duplicate = await deliver(env, body, "event-3");
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicate: true, executionId: firstPayload.executionId });
    expect(jobs).toHaveLength(1);
  });

  it("rejects unapproved event types after signature verification", async () => {
    const { env, jobs } = webhookEnvironment();
    const response = await deliver(env, '{"event":"customer.deleted","input":"hello"}', "event-4");
    expect(response.status).toBe(422);
    expect(jobs).toHaveLength(0);
  });

  it("rejects oversized idempotency keys before D1 persistence", async () => {
    const { env, jobs } = webhookEnvironment();
    const response = await deliver(env, '{"event":"request.created","input":"hello"}', "x".repeat(201));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("200 characters") });
    expect(jobs).toHaveLength(0);
  });

  it("blocks sensitive webhook content before Queue persistence", async () => {
    const { env, jobs } = webhookEnvironment([
      { detector: "ssn", action: "block", direction: "both", enabled: 1 }
    ]);
    const response = await deliver(env, '{"event":"request.created","input":"SSN 123-45-6789"}', "event-5");
    expect(response.status).toBe(422);
    expect(jobs).toHaveLength(0);
  });
});
