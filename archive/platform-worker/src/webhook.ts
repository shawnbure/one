import type { ExecutionRequest, QueueJob } from "@workrr/contracts";
import type { Context } from "hono";
import type { Env } from "./types";
import { assertAsyncExecutionAdmission, sanitizeAsyncExecutionInput } from "./execution";
import { isDlpBlocked } from "./dlp";
import { isContractViolation } from "./contracts";
import { enqueueProcessJob } from "./queue-operations";

interface EndpointRow { id: string; tenant_id: string; blueprint_id: string; secret_binding: string; status: string; accepted_events_json: string; }

export async function receiveWebhook(c: Context<{ Bindings: Env }>): Promise<Response> {
  const endpoint = await c.env.DB.prepare("SELECT * FROM webhook_endpoints WHERE id = ?").bind(c.req.param("endpointId")).first<EndpointRow>();
  if (!endpoint || endpoint.status !== "active") return c.json({ error: "Webhook endpoint is not active" }, 404);
  const secret = secretValue(c.env, endpoint.secret_binding);
  if (!secret) return c.json({ error: "Webhook secret is not configured" }, 503);
  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (contentLength > 1_048_576) return c.json({ error: "Webhook payload exceeds 1 MB" }, 413);
  const raw = await c.req.arrayBuffer();
  if (raw.byteLength > 1_048_576) return c.json({ error: "Webhook payload exceeds 1 MB" }, 413);
  const signature = c.req.header("x-workrr-signature");
  if (!signature || !await validSignature(raw, secret, signature)) return c.json({ error: "Invalid webhook signature" }, 401);
  const idempotencyKey = c.req.header("idempotency-key") ?? c.req.header("x-workrr-event-id");
  if (!idempotencyKey) return c.json({ error: "Idempotency-Key is required" }, 400);
  if (idempotencyKey.length > 200) return c.json({ error: "Idempotency-Key is limited to 200 characters" }, 400);
  const existing = await c.env.DB.prepare(`SELECT execution_id, status FROM webhook_receipts
    WHERE endpoint_id = ? AND idempotency_key = ?`)
    .bind(endpoint.id, idempotencyKey).first<{ execution_id: string | null; status: string }>();
  if (existing && existing.status !== "enqueue_failed") {
    return c.json({ duplicate: true, executionId: existing.execution_id }, 200);
  }
  let payload: { event?: string; input?: string; data?: unknown };
  try { payload = JSON.parse(new TextDecoder().decode(raw)) as typeof payload; }
  catch { return c.json({ error: "Webhook body must be valid JSON" }, 400); }
  const accepted = JSON.parse(endpoint.accepted_events_json) as string[];
  if (accepted.length && (!payload.event || !accepted.includes(payload.event))) return c.json({ error: "Event type is not accepted" }, 422);
  const executionId = existing?.execution_id ?? crypto.randomUUID();
  const request: ExecutionRequest = { blueprintId: endpoint.blueprint_id,
    input: payload.input ?? JSON.stringify(payload.data ?? payload),
    idempotencyKey: `webhook:${endpoint.id}:${idempotencyKey}` };
  try { await assertAsyncExecutionAdmission(c.env, endpoint.tenant_id, endpoint.blueprint_id); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Execution admission failed" }, 409); }
  let protectedRequest: ExecutionRequest;
  try { protectedRequest = await sanitizeAsyncExecutionInput(c.env, endpoint.tenant_id, request, executionId); }
  catch (error) {
    if (isContractViolation(error)) return c.json({ error: error.message }, 422);
    if (!isDlpBlocked(error)) return c.json({ error: "Execution admission inspection failed" }, 400);
    if (existing) {
      await c.env.DB.prepare(`UPDATE webhook_receipts SET status='blocked', last_error=?,
        updated_at=CURRENT_TIMESTAMP WHERE endpoint_id=? AND idempotency_key=?`)
        .bind("DLP policy blocked retry content", endpoint.id, idempotencyKey).run();
    } else {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO webhook_receipts
        (id, tenant_id, endpoint_id, idempotency_key, event_type, execution_id, status)
        VALUES (?, ?, ?, ?, ?, NULL, 'blocked')`)
        .bind(crypto.randomUUID(), endpoint.tenant_id, endpoint.id, idempotencyKey, payload.event ?? null).run();
    }
    return c.json({ error: error instanceof Error ? error.message : "DLP policy blocked webhook content" }, 422);
  }
  const job: QueueJob = { ...protectedRequest, executionId, attempt: 0, tenantId: endpoint.tenant_id };
  const receipt = existing ? null : await c.env.DB.prepare(`INSERT OR IGNORE INTO webhook_receipts
    (id, tenant_id, endpoint_id, idempotency_key, event_type, execution_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'accepted')`)
    .bind(crypto.randomUUID(), endpoint.tenant_id, endpoint.id, idempotencyKey, payload.event ?? null, executionId).run();
  if (receipt && receipt.meta.changes !== 1) {
    const concurrent = await c.env.DB.prepare("SELECT execution_id FROM webhook_receipts WHERE endpoint_id = ? AND idempotency_key = ?")
      .bind(endpoint.id, idempotencyKey).first<{ execution_id: string | null }>();
    return c.json({ duplicate: true, executionId: concurrent?.execution_id ?? null }, 200);
  }
  await c.env.DB.prepare("UPDATE webhook_endpoints SET last_received_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), endpoint.id).run();
  let queued;
  try {
    queued = await enqueueProcessJob(c.env, job, "webhook");
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await c.env.DB.prepare(`UPDATE webhook_receipts SET status='enqueue_failed',
      attempt_count=attempt_count+1, last_error=?, updated_at=CURRENT_TIMESTAMP
      WHERE endpoint_id=? AND idempotency_key=?`)
      .bind(message, endpoint.id, idempotencyKey).run();
    return c.json({ error: "Webhook was verified but Queue handoff failed; retry with the same idempotency key",
      executionId }, 503);
  }
  if (queued.executionId !== executionId) {
    await c.env.DB.prepare(`UPDATE webhook_receipts SET execution_id=?, status='accepted',
      attempt_count=attempt_count+1, last_error=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE endpoint_id=? AND idempotency_key=?`).bind(queued.executionId, endpoint.id, idempotencyKey).run();
  } else {
    await c.env.DB.prepare(`UPDATE webhook_receipts SET status='accepted',
      attempt_count=attempt_count+1, last_error=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE endpoint_id=? AND idempotency_key=?`).bind(endpoint.id, idempotencyKey).run();
  }
  return c.json({ accepted: !queued.duplicate, duplicate: queued.duplicate || undefined,
    executionId: queued.executionId }, queued.duplicate ? 200 : 202);
}

function secretValue(env: Env, binding: string): string | undefined {
  if (binding === "WEBHOOK_INBOX_SECRET") return env.WEBHOOK_INBOX_SECRET;
  return undefined;
}

async function validSignature(body: ArrayBuffer, secret: string, provided: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  const expected = `sha256=${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided.toLowerCase());
  if (a.byteLength !== b.byteLength) return false;
  let mismatch = 0;
  for (let index = 0; index < a.byteLength; index += 1) mismatch |= a[index]! ^ b[index]!;
  return mismatch === 0;
}
