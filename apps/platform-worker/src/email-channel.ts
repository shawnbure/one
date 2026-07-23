import PostalMime from "postal-mime";
import type { ExecutionProfile, ExecutionRequest, QueueJob } from "@workrr/contracts";
import type { Env } from "./types";
import { assertAsyncExecutionAdmission, sanitizeAsyncExecutionInput } from "./execution";
import { isContractViolation } from "./contracts";
import { isDlpBlocked } from "./dlp";
import { enqueueProcessJob } from "./queue-operations";

interface EmailRoute {
  id: string;
  tenant_id: string;
  blueprint_id: string;
  allowed_sender_domains_json: string;
  status: string;
  execution_profile: ExecutionProfile;
}

interface EmailRouteInput {
  name?: string;
  address?: string;
  blueprintId?: string;
  allowedSenderDomains?: string[];
}

const MAX_MESSAGE_BYTES = 1_048_576;
const MAX_INPUT_CHARS = 48_000;

export async function receiveProcessEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const recipient = normalizeAddress(message.to);
  const route = await env.DB.prepare(`SELECT r.id, r.tenant_id, r.blueprint_id,
    r.allowed_sender_domains_json, r.status, b.execution_profile
    FROM inbound_email_routes r
    JOIN agent_blueprints b ON b.id=r.blueprint_id AND b.tenant_id=r.tenant_id
    WHERE r.address=? COLLATE NOCASE`).bind(recipient).first<EmailRoute>();
  if (!route || route.status !== "active") {
    message.setReject("This Workrr email route is not active");
    return;
  }
  if (message.rawSize > MAX_MESSAGE_BYTES) {
    await recordRejected(env, route, message, "rejected");
    message.setReject("Message exceeds the 1 MB Workrr intake limit");
    return;
  }
  const sender = normalizeAddress(message.from);
  const allowedDomains = parseDomains(route.allowed_sender_domains_json);
  if (!senderAllowed(sender, allowedDomains)) {
    await recordRejected(env, route, message, "rejected");
    message.setReject("Sender domain is not authorized for this Workrr route");
    return;
  }

  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const messageId = boundedHeader(message.headers.get("message-id")) ||
    `generated:${await sha256Bytes(raw)}`;
  const messageIdHash = await sha256(messageId);
  const existing = await env.DB.prepare(`SELECT execution_id, status FROM inbound_email_receipts
    WHERE route_id=? AND message_id_hash=?`).bind(route.id, messageIdHash)
    .first<{ execution_id: string | null; status: string }>();
  if (existing && existing.status !== "enqueue_failed") return;

  const subject = cleanText(parsed.subject || "(no subject)", 500);
  const body = cleanText(parsed.text || htmlToText(parsed.html || ""), MAX_INPUT_CHARS);
  if (!body) {
    await insertReceipt(env, route, sender, messageIdHash, subject, null, "rejected", parsed.attachments.length);
    message.setReject("A plain-text message body is required");
    return;
  }

  const executionId = existing?.execution_id || crypto.randomUUID();
  const idempotencyKey = `email:${route.id}:${messageIdHash}`;
  const request = await emailExecutionRequest(
    route.execution_profile, route.blueprint_id, sender, message.headers,
    messageIdHash, subject, body, idempotencyKey
  );
  try {
    await assertAsyncExecutionAdmission(env, route.tenant_id, route.blueprint_id);
    const protectedRequest = await sanitizeAsyncExecutionInput(env, route.tenant_id, request, executionId);
    if (!existing) {
      const inserted = await insertReceipt(env, route, sender, messageIdHash, subject, executionId,
        "accepted", parsed.attachments.length);
      if (!inserted) return;
    }
    const job: QueueJob = { ...protectedRequest, executionId, attempt: 0, tenantId: route.tenant_id };
    try {
      await enqueueProcessJob(env, job, "email");
      if (existing) await env.DB.prepare(`UPDATE inbound_email_receipts SET status='accepted'
        WHERE route_id=? AND message_id_hash=? AND status='enqueue_failed'`).bind(route.id, messageIdHash).run();
    } catch (error) {
      await env.DB.prepare(`UPDATE inbound_email_receipts SET status='enqueue_failed'
        WHERE route_id=? AND message_id_hash=?`).bind(route.id, messageIdHash).run();
      throw error;
    }
    await env.DB.prepare(`UPDATE inbound_email_routes SET last_received_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(route.id).run();
  } catch (error) {
    if (isContractViolation(error) || isDlpBlocked(error)) {
      await insertReceipt(env, route, sender, messageIdHash, subject, null, "blocked", parsed.attachments.length);
      message.setReject("Message did not pass the Workrr process intake policy");
      return;
    }
    throw error;
  }
}

export async function listEmailRoutes(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare(`SELECT r.id, r.name, r.address, r.blueprint_id,
    b.name process_name, b.execution_profile, r.allowed_sender_domains_json, r.status,
    r.created_at, r.updated_at, r.last_received_at
    FROM inbound_email_routes r JOIN agent_blueprints b
      ON b.id=r.blueprint_id AND b.tenant_id=r.tenant_id
    WHERE r.tenant_id=? ORDER BY r.name`).bind(tenantId).all();
  return results;
}

export async function createEmailRoute(env: Env, tenantId: string, actorId: string, input: EmailRouteInput) {
  const config = await validateRouteInput(env, tenantId, input);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO inbound_email_routes
      (id, tenant_id, name, address, blueprint_id, allowed_sender_domains_json)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(id, tenantId, config.name, config.address,
      config.blueprintId, JSON.stringify(config.allowedSenderDomains)),
    audit(env, tenantId, actorId, "email_route.created", id, {
      address: config.address, blueprintId: config.blueprintId,
      allowedSenderDomains: config.allowedSenderDomains
    })
  ]);
  return { id, ...config, status: "disabled" };
}

export async function updateEmailRoute(
  env: Env, tenantId: string, actorId: string, routeId: string, input: EmailRouteInput
) {
  const current = await env.DB.prepare(`SELECT status FROM inbound_email_routes
    WHERE id=? AND tenant_id=?`).bind(routeId, tenantId).first<{ status: string }>();
  if (!current) throw new Error("Email route was not found");
  if (current.status !== "disabled") throw new Error("Disable the email route before changing it");
  const config = await validateRouteInput(env, tenantId, input);
  await env.DB.batch([
    env.DB.prepare(`UPDATE inbound_email_routes SET name=?, address=?, blueprint_id=?,
      allowed_sender_domains_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(config.name, config.address, config.blueprintId,
        JSON.stringify(config.allowedSenderDomains), routeId, tenantId),
    audit(env, tenantId, actorId, "email_route.updated", routeId, {
      address: config.address, blueprintId: config.blueprintId,
      allowedSenderDomains: config.allowedSenderDomains
    })
  ]);
  return { id: routeId, ...config, status: "disabled" };
}

export async function setEmailRouteStatus(
  env: Env, tenantId: string, actorId: string, routeId: string, status: "active" | "disabled"
) {
  const route = await env.DB.prepare(`SELECT r.id, r.blueprint_id, r.allowed_sender_domains_json,
    b.execution_profile, b.status process_status
    FROM inbound_email_routes r JOIN agent_blueprints b
      ON b.id=r.blueprint_id AND b.tenant_id=r.tenant_id
    WHERE r.id=? AND r.tenant_id=?`).bind(routeId, tenantId)
    .first<Record<string, string>>();
  if (!route) throw new Error("Email route was not found");
  if (status === "active") {
    if (route.process_status !== "active") throw new Error("Publish and activate the process before enabling email intake");
    if (route.execution_profile === "entity") {
      throw new Error("Entity-sticky processes require an explicit entity resolver and cannot use email intake");
    }
    if (!parseDomains(route.allowed_sender_domains_json || "[]").length) {
      throw new Error("At least one authorized sender domain is required");
    }
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE inbound_email_routes SET status=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=?`).bind(status, routeId, tenantId),
    audit(env, tenantId, actorId, "email_route.status_changed", routeId, { status })
  ]);
  return { id: routeId, status };
}

export async function listEmailReceipts(env: Env, tenantId: string, routeId: string) {
  const route = await env.DB.prepare(`SELECT id FROM inbound_email_routes
    WHERE id=? AND tenant_id=?`).bind(routeId, tenantId).first();
  if (!route) throw new Error("Email route was not found");
  const { results } = await env.DB.prepare(`SELECT id, execution_id, status, attachment_count, received_at
    FROM inbound_email_receipts WHERE tenant_id=? AND route_id=?
    ORDER BY received_at DESC LIMIT 50`).bind(tenantId, routeId).all();
  return results;
}

async function validateRouteInput(env: Env, tenantId: string, input: EmailRouteInput) {
  const name = cleanText(input.name || "", 80);
  if (name.length < 3) throw new Error("Email route name must be at least 3 characters");
  const address = normalizeAddress(input.address || "");
  if (!isEmail(address)) throw new Error("A valid routed email address is required");
  const blueprintId = cleanText(input.blueprintId || "", 100);
  const process = await env.DB.prepare(`SELECT execution_profile FROM agent_blueprints
    WHERE id=? AND tenant_id=?`).bind(blueprintId, tenantId).first<{ execution_profile: string }>();
  if (!process) throw new Error("Process was not found");
  if (process.execution_profile === "entity") {
    throw new Error("Entity-sticky processes require an explicit entity resolver");
  }
  const allowedSenderDomains = [...new Set((input.allowedSenderDomains || []).map(normalizeDomain))];
  if (!allowedSenderDomains.length || allowedSenderDomains.length > 20 ||
    allowedSenderDomains.some((domain) => !isDomain(domain))) {
    throw new Error("Provide 1 to 20 valid authorized sender domains");
  }
  return { name, address, blueprintId, allowedSenderDomains };
}

export async function emailExecutionRequest(
  profile: ExecutionProfile, blueprintId: string, sender: string, headers: Headers, messageIdHash: string,
  subject: string, body: string, idempotencyKey: string
): Promise<ExecutionRequest> {
  const request: ExecutionRequest = {
    blueprintId,
    input: `Email subject: ${subject}\n\n${body}`.slice(0, MAX_INPUT_CHARS),
    idempotencyKey,
    metadata: { channel: "email", attachments: "not_ingested" }
  };
  const senderIdentity = sender.toLowerCase();
  const threadRoot = boundedHeader(headers.get("references"))?.split(/\s+/)[0] ||
    boundedHeader(headers.get("in-reply-to")) || messageIdHash;
  if (profile === "conversation") request.threadId = `email-${(await sha256(threadRoot)).slice(0, 32)}`;
  if (profile === "consumer") request.consumerId = `email-${(await sha256(senderIdentity)).slice(0, 32)}`;
  if (profile === "shared_shard") request.shardKey = `email-${(await sha256(senderIdentity)).slice(0, 2)}`;
  return request;
}

async function insertReceipt(
  env: Env, route: EmailRoute, sender: string, messageIdHash: string, subject: string,
  executionId: string | null, status: string, attachmentCount: number
) {
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO inbound_email_receipts
    (id, tenant_id, route_id, sender_hash, message_id_hash, subject_checksum,
      execution_id, status, attachment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), route.tenant_id, route.id, await sha256(sender), messageIdHash,
      await sha256(subject), executionId, status, attachmentCount).run();
  return result.meta.changes === 1;
}

async function recordRejected(
  env: Env, route: EmailRoute, message: ForwardableEmailMessage, status: string
) {
  const messageKey = boundedHeader(message.headers.get("message-id")) ||
    `${message.from}:${boundedHeader(message.headers.get("date"))}:${message.rawSize}`;
  await insertReceipt(env, route, normalizeAddress(message.from), await sha256(messageKey),
    boundedHeader(message.headers.get("subject")), null, status, 0);
}

function audit(env: Env, tenantId: string, actorId: string, eventType: string, targetId: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'email_route', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, targetId, JSON.stringify(detail));
}

function parseDomains(value: string) {
  try {
    const values = JSON.parse(value) as unknown;
    return Array.isArray(values) ? values.map(String).map(normalizeDomain).filter(isDomain) : [];
  } catch { return []; }
}

function senderAllowed(sender: string, domains: string[]) {
  const domain = sender.split("@")[1] || "";
  return domains.includes(domain);
}

function normalizeAddress(value: string) { return value.trim().toLowerCase(); }
function normalizeDomain(value: string) { return value.trim().toLowerCase().replace(/^@/, ""); }
function isEmail(value: string) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && value.length <= 254; }
function isDomain(value: string) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
}
function boundedHeader(value: string | null) { return cleanText(value || "", 500); }
function cleanText(value: string, max: number) {
  return value.replace(/\0/g, "").replace(/\r\n/g, "\n").trim().slice(0, max);
}
function htmlToText(value: string) {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}
async function sha256(value: string) {
  return sha256Bytes(new TextEncoder().encode(value));
}
async function sha256Bytes(value: BufferSource) {
  const bytes = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
