import type { Env } from "./types";
import { getMicrosoftAccessToken } from "./oauth";

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
  digest_batch_id?: string | null;
  digest_item_count?: number | null;
}

interface DeliveryPolicy {
  id: string;
  channel: string;
  severity: string;
  quiet_hours_enabled: number;
  quiet_start_hour_utc: number;
  quiet_end_hour_utc: number;
  critical_bypass: number;
  digest_mode?: "immediate" | "hourly" | "daily";
  digest_hour_utc?: number;
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
    const channel = String(policy.channel);
    const status = channel === "in_app" ? "delivered" : "pending";
    const now = new Date();
    const scheduledFor = channel === "in_app" ? null : nextDeliveryTime(policy as unknown as DeliveryPolicy, now);
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO notification_events
      (id, tenant_id, policy_id, event_type, severity, title, detail, target_type, target_id,
       delivery_status, delivered_at, delivery_scheduled_for)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, tenantId, policy.id, event.eventType, policy.severity, event.title, event.detail,
        event.targetType ?? null, event.targetId ?? null, status, status === "delivered" ? now.toISOString() : null,
        scheduledFor?.toISOString() ?? null).run();
    if (inserted.meta.changes !== 1) continue;
    ids.push(id);
    if (channel === "webhook" || channel === "email") {
      const bypassesSchedule = String(policy.severity) === "critical" && Number(policy.critical_bypass);
      if ((!scheduledFor || scheduledFor <= now) &&
          (String(policy.digest_mode ?? "immediate") === "immediate" || bypassesSchedule)) {
        await env.PROCESS_QUEUE.send({ kind: "notification_delivery", tenantId, eventId: id, channel }, { contentType: "json" });
        await env.DB.prepare(`UPDATE notification_events SET delivery_queued_at=?
          WHERE id=? AND tenant_id=?`).bind(now.toISOString(), id, tenantId).run();
      }
    }
  }
  return ids;
}

export function nextDeliveryTime(policy: DeliveryPolicy, now: Date): Date {
  if (policy.severity === "critical" && Number(policy.critical_bypass)) return now;
  let candidate = digestTime(policy, now);
  if (!Number(policy.quiet_hours_enabled)) return candidate;
  const start = Number(policy.quiet_start_hour_utc);
  const end = Number(policy.quiet_end_hour_utc);
  if (start === end || !inQuietHours(candidate.getUTCHours(), start, end)) return candidate;
  candidate = new Date(candidate);
  candidate.setUTCMinutes(0, 0, 0);
  for (let hour = 0; hour < 24; hour += 1) {
    candidate.setUTCHours(candidate.getUTCHours() + 1);
    if (!inQuietHours(candidate.getUTCHours(), start, end)) return candidate;
  }
  return now;
}

export async function enqueueDueNotificationDeliveries(env: Env, now = new Date()) {
  const { results } = await env.DB.prepare(`SELECT e.id, e.tenant_id, e.policy_id, e.title, e.detail,
      e.event_type, e.severity, e.target_type, e.target_id, p.channel, p.digest_mode
    FROM notification_events e JOIN notification_policies p
      ON p.id=e.policy_id AND p.tenant_id=e.tenant_id
    WHERE e.delivery_status='pending' AND e.delivery_queued_at IS NULL
      AND e.delivery_scheduled_for IS NOT NULL AND datetime(e.delivery_scheduled_for) <= datetime(?)
      AND p.enabled=1 AND p.channel IN ('email','webhook')
    ORDER BY e.delivery_scheduled_for LIMIT 100`).bind(now.toISOString())
    .all<{ id: string; tenant_id: string; policy_id: string; title: string; detail: string;
      event_type: string; severity: string; target_type: string | null; target_id: string | null;
      channel: "email" | "webhook"; digest_mode: "immediate" | "hourly" | "daily" }>();
  let queued = 0;
  const digestGroups = new Map<string, typeof results>();
  for (const event of results) {
    if (event.channel === "email" && event.digest_mode !== "immediate") {
      const key = `${event.tenant_id}:${event.policy_id}`;
      digestGroups.set(key, [...(digestGroups.get(key) ?? []), event]);
      continue;
    }
    const claim = await env.DB.prepare(`UPDATE notification_events SET delivery_queued_at=?
      WHERE id=? AND tenant_id=? AND delivery_status='pending' AND delivery_queued_at IS NULL`)
      .bind(now.toISOString(), event.id, event.tenant_id).run();
    if (claim.meta.changes !== 1) continue;
    try {
      await env.PROCESS_QUEUE.send({ kind: "notification_delivery", tenantId: event.tenant_id,
        eventId: event.id, channel: event.channel }, { contentType: "json" });
      queued += 1;
    } catch (error) {
      await env.DB.prepare(`UPDATE notification_events SET delivery_queued_at=NULL, last_error=?
        WHERE id=? AND tenant_id=? AND delivery_status='pending'`)
        .bind((error instanceof Error ? error.message : String(error)).slice(0, 500), event.id, event.tenant_id).run();
    }
  }
  for (const events of digestGroups.values()) {
    queued += await enqueueEmailDigest(env, events, now);
  }
  return { queued };
}

function inQuietHours(hour: number, start: number, end: number) {
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function digestTime(policy: DeliveryPolicy, now: Date) {
  if (policy.digest_mode === "hourly") {
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }
  if (policy.digest_mode === "daily") {
    const next = new Date(now);
    next.setUTCHours(Number(policy.digest_hour_utc ?? 8), 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  return now;
}

async function enqueueEmailDigest(
  env: Env,
  events: Array<{ id: string; tenant_id: string; policy_id: string; title: string; detail: string;
    event_type: string; severity: string; target_type: string | null; target_id: string | null;
    channel: "email" | "webhook"; digest_mode: "immediate" | "hourly" | "daily" }>,
  now: Date,
) {
  if (!events.length) return 0;
  const first = events[0]!;
  const batchId = crypto.randomUUID();
  const deliveryEventId = crypto.randomUUID();
  const placeholders = events.map(() => "?").join(",");
  const claimed = await env.DB.prepare(`UPDATE notification_events
    SET digest_batch_id=?, delivery_status='recorded', delivery_queued_at=?
    WHERE id IN (${placeholders}) AND tenant_id=? AND delivery_status='pending'
      AND delivery_queued_at IS NULL AND digest_batch_id IS NULL`)
    .bind(batchId, now.toISOString(), ...events.map((event) => event.id), first.tenant_id).run();
  if (claimed.meta.changes !== events.length) {
    await env.DB.prepare(`UPDATE notification_events SET digest_batch_id=NULL, delivery_status='pending',
      delivery_queued_at=NULL WHERE tenant_id=? AND digest_batch_id=? AND delivery_status='recorded'`)
      .bind(first.tenant_id, batchId).run();
    return 0;
  }
  const detail = events.map((event, index) =>
    `${index + 1}. [${event.severity}] ${event.title}: ${event.detail}`).join("\n").slice(0, 8000);
  await env.DB.prepare(`INSERT INTO notification_events
    (id, tenant_id, policy_id, event_type, severity, title, detail, target_type, target_id,
     delivery_status, delivery_scheduled_for, delivery_queued_at, digest_batch_id, digest_item_count)
    VALUES (?, ?, ?, 'notification.digest', 'warning', ?, ?, 'notification_digest', ?,
      'pending', ?, ?, ?, ?)`)
    .bind(deliveryEventId, first.tenant_id, first.policy_id,
      `Workrr digest · ${events.length} notification${events.length === 1 ? "" : "s"}`,
      detail, batchId, now.toISOString(), now.toISOString(), batchId, events.length).run();
  try {
    await env.PROCESS_QUEUE.send({ kind: "notification_delivery", tenantId: first.tenant_id,
      eventId: deliveryEventId, channel: "email", digestBatchId: batchId }, { contentType: "json" });
    return 1;
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM notification_events WHERE id=? AND tenant_id=?`)
        .bind(deliveryEventId, first.tenant_id),
      env.DB.prepare(`UPDATE notification_events SET digest_batch_id=NULL, delivery_status='pending',
        delivery_queued_at=NULL, last_error=? WHERE tenant_id=? AND digest_batch_id=? AND delivery_status='recorded'`)
        .bind((error instanceof Error ? error.message : String(error)).slice(0, 500),
          first.tenant_id, batchId)
    ]);
    return 0;
  }
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

export async function deliverNotification(env: Env, tenantId: string, eventId: string, channelHint?: "webhook" | "email") {
  if (channelHint === "webhook") return deliverNotificationWebhook(env, tenantId, eventId);
  if (channelHint === "email") return deliverNotificationEmail(env, tenantId, eventId);
  const event = await env.DB.prepare(`SELECT e.delivery_status, p.channel FROM notification_events e
    JOIN notification_policies p ON p.id=e.policy_id AND p.tenant_id=e.tenant_id
    WHERE e.id=? AND e.tenant_id=?`).bind(eventId, tenantId)
    .first<{ delivery_status: string; channel: string }>();
  if (!event) throw new Error("Notification delivery was not found");
  if (event.delivery_status === "delivered") return { delivered: true, duplicate: true };
  if (event.channel === "webhook") return deliverNotificationWebhook(env, tenantId, eventId);
  if (event.channel === "email") return deliverNotificationEmail(env, tenantId, eventId);
  throw new Error("Notification channel does not use external delivery");
}

export async function deliverNotificationEmail(
  env: Env,
  tenantId: string,
  eventId: string,
  fetcher: typeof fetch = fetch,
) {
  const delivery = await env.DB.prepare(`SELECT e.id, e.tenant_id, e.event_type, e.severity, e.title, e.detail,
    e.target_type, e.target_id, e.delivery_status, e.created_at, e.digest_batch_id, e.digest_item_count,
    p.destination, p.channel, NULL secret_binding
    FROM notification_events e JOIN notification_policies p ON p.id = e.policy_id AND p.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ?`).bind(eventId, tenantId).first<DeliveryRow>();
  if (!delivery) throw new Error("Notification delivery was not found");
  if (delivery.delivery_status === "delivered") return { delivered: true, duplicate: true };
  if (delivery.channel !== "email") throw new Error("Notification is not an email delivery");
  const destination = safeEmailDestination(delivery.destination);
  const token = await getMicrosoftAccessToken(env, tenantId, "Mail.Send", fetcher);
  const started = performance.now();
  let response: Response;
  try {
    response = await fetcher("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: `[Workrr ${delivery.severity}] ${delivery.title}`.slice(0, 200),
          body: {
            contentType: "Text",
            content: `${delivery.detail}\n\nEvent: ${delivery.event_type}\nReference: ${delivery.target_type ?? "event"} ${delivery.target_id ?? delivery.id}`,
          },
          toRecipients: [{ emailAddress: { address: destination } }],
        },
        saveToSentItems: true,
      }),
    });
  } catch (error) {
    await recordAttempt(env, tenantId, eventId, null, error instanceof Error ? error.message : String(error));
    await recordMicrosoftLog(env, tenantId, eventId, 0, started);
    throw error;
  }
  await recordMicrosoftLog(env, tenantId, eventId, response.status, started);
  if (response.status !== 202) {
    const message = `Microsoft Graph returned HTTP ${response.status}`;
    await recordAttempt(env, tenantId, eventId, response.status, message);
    throw new Error(message);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE notification_events SET delivery_status = 'delivered', delivered_at = ?,
    attempt_count = attempt_count + 1, last_attempt_at = ?, last_error = NULL, response_status = 202
    WHERE id = ? AND tenant_id = ? AND delivery_status <> 'delivered'`)
    .bind(now, now, eventId, tenantId).run();
  if (delivery.event_type === "notification.digest" && delivery.digest_batch_id) {
    await env.DB.prepare(`UPDATE notification_events SET delivery_status='delivered', delivered_at=?
      WHERE tenant_id=? AND digest_batch_id=? AND id<>? AND delivery_status='recorded'`)
      .bind(now, tenantId, delivery.digest_batch_id, eventId).run();
  }
  return { delivered: true, duplicate: false, status: 202 };
}

export async function failNotificationDelivery(env: Env, tenantId: string, eventId: string, error: unknown) {
  await env.DB.prepare(`UPDATE notification_events SET delivery_status = 'failed', last_error = ?,
    last_attempt_at = COALESCE(last_attempt_at, ?)
    WHERE id = ? AND tenant_id = ? AND delivery_status <> 'delivered'`)
    .bind((error instanceof Error ? error.message : String(error)).slice(0, 500), new Date().toISOString(), eventId, tenantId).run();
  const digest = await env.DB.prepare(`SELECT digest_batch_id FROM notification_events
    WHERE id=? AND tenant_id=? AND event_type='notification.digest'`).bind(eventId, tenantId)
    .first<{ digest_batch_id: string | null }>();
  if (digest?.digest_batch_id) {
    await env.DB.prepare(`UPDATE notification_events SET delivery_status='failed', last_error=?
      WHERE tenant_id=? AND digest_batch_id=? AND id<>? AND delivery_status='recorded'`)
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 500),
        tenantId, digest.digest_batch_id, eventId).run();
  }
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

export function safeEmailDestination(value: string | null | undefined): string {
  const email = value?.trim().toLowerCase() ?? "";
  if (email.length > 254 || /[\r\n,;]/.test(email) ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(email)) {
    throw new Error("Email destination must be one valid recipient address");
  }
  return email;
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

async function recordMicrosoftLog(env: Env, tenantId: string, eventId: string, status: number, started: number) {
  await env.DB.prepare(`INSERT INTO api_logs
    (id, tenant_id, actor_id, trace_id, direction, method, path, status, duration_ms, target)
    VALUES (?, ?, 'system', ?, 'outbound', 'POST', '/v1.0/me/sendMail', ?, ?, 'https://graph.microsoft.com')`)
    .bind(crypto.randomUUID(), tenantId, eventId, status, Math.round(performance.now() - started)).run();
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
