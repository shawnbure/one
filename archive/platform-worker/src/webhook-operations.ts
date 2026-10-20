import type { Env } from "./types";
import { assertAsyncExecutionAdmission } from "./execution";

interface WebhookInput {
  name?: unknown;
  blueprintId?: unknown;
  acceptedEvents?: unknown;
}

export async function createWebhookEndpoint(env: Env, tenantId: string, actorId: string, input: WebhookInput) {
  const config = await validateConfig(env, tenantId, input);
  const id = `wh_${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO webhook_endpoints
      (id, tenant_id, name, blueprint_id, secret_binding, status, accepted_events_json)
      VALUES (?, ?, ?, ?, 'WEBHOOK_INBOX_SECRET', 'disabled', ?)`)
      .bind(id, tenantId, config.name, config.blueprintId, JSON.stringify(config.acceptedEvents)),
    audit(env, tenantId, actorId, "webhook.created", id, config)
  ]);
  return { id, ...config, status: "disabled" as const, secretConfigured: Boolean(env.WEBHOOK_INBOX_SECRET) };
}

export async function updateWebhookEndpoint(env: Env, tenantId: string, actorId: string,
  endpointId: string, input: WebhookInput) {
  const current = await env.DB.prepare(`SELECT status FROM webhook_endpoints WHERE id=? AND tenant_id=?`)
    .bind(endpointId, tenantId).first<{ status: string }>();
  if (!current) throw new Error("Webhook endpoint was not found");
  if (current.status !== "disabled") throw new Error("Disable the webhook before changing its routing configuration");
  const config = await validateConfig(env, tenantId, input);
  await env.DB.batch([
    env.DB.prepare(`UPDATE webhook_endpoints SET name=?, blueprint_id=?, accepted_events_json=?
      WHERE id=? AND tenant_id=? AND status='disabled'`)
      .bind(config.name, config.blueprintId, JSON.stringify(config.acceptedEvents), endpointId, tenantId),
    audit(env, tenantId, actorId, "webhook.configuration_updated", endpointId, config)
  ]);
  return { id: endpointId, ...config, status: "disabled" as const };
}

export async function setWebhookEndpointStatus(env: Env, tenantId: string, actorId: string,
  endpointId: string, status: "active" | "disabled") {
  const endpoint = await env.DB.prepare(`SELECT id, blueprint_id, status FROM webhook_endpoints
    WHERE id=? AND tenant_id=?`).bind(endpointId, tenantId)
    .first<{ id: string; blueprint_id: string; status: string }>();
  if (!endpoint) throw new Error("Webhook endpoint was not found");
  if (status === "active") {
    if (!env.WEBHOOK_INBOX_SECRET) throw new Error("Configure WEBHOOK_INBOX_SECRET before activating this endpoint");
    await assertAsyncExecutionAdmission(env, tenantId, endpoint.blueprint_id);
  }
  if (endpoint.status === status) return { updated: false, status };
  await env.DB.batch([
    env.DB.prepare("UPDATE webhook_endpoints SET status=? WHERE id=? AND tenant_id=?")
      .bind(status, endpointId, tenantId),
    audit(env, tenantId, actorId, "webhook.status_changed", endpointId, {
      previousStatus: endpoint.status, status, blueprintId: endpoint.blueprint_id
    })
  ]);
  return { updated: true, status };
}

export async function listWebhookReceipts(env: Env, tenantId: string, endpointId: string) {
  const endpoint = await env.DB.prepare(`SELECT id, name FROM webhook_endpoints WHERE id=? AND tenant_id=?`)
    .bind(endpointId, tenantId).first<{ id: string; name: string }>();
  if (!endpoint) throw new Error("Webhook endpoint was not found");
  const { results } = await env.DB.prepare(`SELECT r.id, r.event_type, r.execution_id, r.received_at,
    r.status receipt_status, r.attempt_count, e.status execution_status, e.completed_at
    FROM webhook_receipts r LEFT JOIN executions e
      ON e.id=r.execution_id AND e.tenant_id=r.tenant_id
    WHERE r.tenant_id=? AND r.endpoint_id=? ORDER BY r.received_at DESC LIMIT 25`)
    .bind(tenantId, endpointId).all();
  return { endpoint, receipts: results };
}

async function validateConfig(env: Env, tenantId: string, input: WebhookInput) {
  const name = String(input.name ?? "").trim();
  if (name.length < 3 || name.length > 80) throw new Error("Webhook name must be 3–80 characters");
  const blueprintId = String(input.blueprintId ?? "").trim();
  const process = await env.DB.prepare(`SELECT id FROM agent_blueprints WHERE id=? AND tenant_id=?`)
    .bind(blueprintId, tenantId).first();
  if (!process) throw new Error("Select a process in this tenant");
  if (!Array.isArray(input.acceptedEvents)) throw new Error("Accepted events must be an array");
  const acceptedEvents = [...new Set(input.acceptedEvents.map((value) => String(value).trim()).filter(Boolean))];
  if (acceptedEvents.length < 1 || acceptedEvents.length > 20) throw new Error("Define 1–20 accepted event types");
  if (acceptedEvents.some((event) => !/^[a-z][a-z0-9_.:-]{1,79}$/.test(event))) {
    throw new Error("Event types must use lowercase letters, numbers, dots, colons, underscores, or hyphens");
  }
  return { name, blueprintId, acceptedEvents };
}

function audit(env: Env, tenantId: string, actorId: string, eventType: string, endpointId: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'webhook', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, endpointId, JSON.stringify(detail));
}
