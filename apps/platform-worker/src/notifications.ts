import type { Env } from "./types";

interface DeliveryRow {
  id: string;
  tenant_id: string;
  event_type: string;
  severity: string;
  title: string;
  detail: string;
  target_type: string | null;
  target_id: string | null;
  delivery_status: string;
  created_at: string;
  destination: string;
  channel: string;
  secret_binding: string | null;
}

export async function emitNotification(env: Env, tenantId: string, event: {
  eventType: string; title: string; detail: string; targetType?: string; targetId?: string;
}) {
  const policies = await env.DB.prepare(`SELECT * FROM notification_policies
    WHERE tenant_id = ? AND event_type = ? AND enabled = 1`).bind(tenantId, event.eventType).all<Record<string, string | number | null>>();
  if (!policies.results.length) return [];
  const ids: string[] = [];
  for (const policy of policies.results) {
    const id = crypto.randomUUID();
    ids.push(id);
    const channel = String(policy.channel);
    const status = channel === "in_app" ? "delivered" : "pending";
    await env.DB.prepare(`INSERT INTO notification_events
      (id, tenant_id, policy_id, event_type, severity, title, detail, target_type, target_id, delivery_status, delivered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, tenantId, policy.id, event.eventType, policy.severity, event.title, event.detail,
        event.targetType ?? null, event.targetId ?? null, status, status === "delivered" ? new Date().toISOString() : null).run();
    if (channel === "webhook") {
      await env.PROCESS_QUEUE.send({ kind: "notification_delivery", tenantId, eventId: id }, { contentType: "json" });
    }
  }
  return ids;
}

export async function deliverNotificationWebhook(env: Env, tenantId: string, eventId: string) {
  const delivery = await env.DB.prepare(`SELECT e.id, e.tenant_id, e.event_type, e.severity, e.title, e.detail,
    e.target_type, e.target_id, e.delivery_status, e.created_at, p.destination, p.channel, r.secret_binding
    FROM notification_events e JOIN notification_policies p ON p.id = e.policy_id AND p.tenant_id = e.tenant_id
    LEFT JOIN integration_credential_refs r ON r.id = p.credential_ref_id AND r.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ?`).bind(eventId, tenantId).first<DeliveryRow>();
  if (!delivery) throw new Error("Notification delivery was not found");
  if (delivery.delivery_status === "delivered") return { delivered: true, duplicate: true };
  if (delivery.channel !== "webhook") throw new Error("Notification is not a webhook delivery");
  const destination = safeWebhookDestination(delivery.destination);
  const secret = secretValue(env, delivery.secret_binding);
  if (!secret) throw new Error("Outbound webhook signing credential is not configured");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    id: delivery.id,
    type: delivery.event_type,
    severity: delivery.severity,
    createdAt: delivery.created_at,
    data: {
      title: delivery.title,
      detail: delivery.detail,
      targetType: delivery.target_type,
      targetId: delivery.target_id
    }
  });
  const signature = await hmacSignature(`${timestamp}.${body}`, secret);
  let response: Response;
  const started = performance.now();
  try {
    response = await fetch(destination, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "Workrr-One-Webhook/1.0",
        "x-workrr-delivery": delivery.id,
        "x-workrr-event": delivery.event_type,
        "x-workrr-timestamp": timestamp,
        "x-workrr-signature": `v1=${signature}`
      },
      body
    });
  } catch (error) {
    await recordAttempt(env, tenantId, eventId, null, error instanceof Error ? error.message : String(error));
    await recordOutboundLog(env, tenantId, eventId, destination, 0, started);
    throw error;
  }
  await recordOutboundLog(env, tenantId, eventId, destination, response.status, started);
  if (response.status < 200 || response.status >= 300) {
    const message = `Destination returned HTTP ${response.status}`;
    await recordAttempt(env, tenantId, eventId, response.status, message);
    throw new Error(message);
  }
  await env.DB.prepare(`UPDATE notification_events SET delivery_status = 'delivered', delivered_at = ?,
    attempt_count = attempt_count + 1, last_attempt_at = ?, last_error = NULL, response_status = ?
    WHERE id = ? AND tenant_id = ? AND delivery_status <> 'delivered'`)
    .bind(new Date().toISOString(), new Date().toISOString(), response.status, eventId, tenantId).run();
  return { delivered: true, duplicate: false, status: response.status };
}

export async function failNotificationDelivery(env: Env, tenantId: string, eventId: string, error: unknown) {
  await env.DB.prepare(`UPDATE notification_events SET delivery_status = 'failed', last_error = ?,
    last_attempt_at = COALESCE(last_attempt_at, ?)
    WHERE id = ? AND tenant_id = ? AND delivery_status <> 'delivered'`)
    .bind((error instanceof Error ? error.message : String(error)).slice(0, 500), new Date().toISOString(), eventId, tenantId).run();
}

export function safeWebhookDestination(value: string | null | undefined): string {
  if (!value) throw new Error("Webhook destination is not configured");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Webhook destination must be a valid URL"); }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search ||
      hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      privateIp(hostname)) {
    throw new Error("Webhook destination must be a public HTTPS URL on port 443 without credentials or query parameters");
  }
  url.hash = "";
  return url.toString();
}

async function recordAttempt(env: Env, tenantId: string, eventId: string, status: number | null, error: string) {
  await env.DB.prepare(`UPDATE notification_events SET attempt_count = attempt_count + 1, last_attempt_at = ?,
    last_error = ?, response_status = ? WHERE id = ? AND tenant_id = ? AND delivery_status <> 'delivered'`)
    .bind(new Date().toISOString(), error.slice(0, 500), status, eventId, tenantId).run();
}

async function recordOutboundLog(env: Env, tenantId: string, eventId: string, destination: string, status: number, started: number) {
  const url = new URL(destination);
  await env.DB.prepare(`INSERT INTO api_logs
    (id, tenant_id, actor_id, trace_id, direction, method, path, status, duration_ms, target)
    VALUES (?, ?, 'system', ?, 'outbound', 'POST', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, eventId, "/signed-notification", status, Math.round(performance.now() - started), url.origin).run();
}

function secretValue(env: Env, binding: string | null): string | undefined {
  if (binding === "NOTIFICATION_WEBHOOK_SECRET") return env.NOTIFICATION_WEBHOOK_SECRET;
  return undefined;
}

async function hmacSignature(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function privateIp(hostname: string) {
  if (/^(127|10)\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:")) return true;
  return hostname === "0.0.0.0";
}
