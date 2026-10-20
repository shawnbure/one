import { emitNotification } from "./notifications";
import type { Env } from "./types";

export async function updateConnectionLifecycle(env: Env, tenantId: string, actorId: string, connectionId: string,
  input: { credentialExpiresAt?: string | null; rotationOwner?: string | null; lastRotatedAt?: string | null }) {
  const connection = await env.DB.prepare("SELECT id, name FROM connections WHERE id=? AND tenant_id=?")
    .bind(connectionId, tenantId).first<{ id: string; name: string }>();
  if (!connection) throw new Error("Connection was not found");
  const expiresAt = optionalDate(input.credentialExpiresAt, "Credential expiry");
  const lastRotatedAt = optionalDate(input.lastRotatedAt, "Last rotation");
  if (lastRotatedAt && new Date(lastRotatedAt) > new Date(Date.now() + 5 * 60_000)) {
    throw new Error("Last rotation cannot be in the future");
  }
  let rotationOwner: string | null = null;
  if (input.rotationOwner) {
    const member = await env.DB.prepare(`SELECT email FROM tenant_members
      WHERE tenant_id=? AND status='active' AND (id=? OR lower(email)=lower(?))
        AND role IN ('admin','builder','owner','operator')`)
      .bind(tenantId, input.rotationOwner, input.rotationOwner).first<{ email: string }>();
    if (!member) throw new Error("Rotation owner must be an active administrator, builder, owner, or operator");
    rotationOwner = member.email;
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE connections SET credential_expires_at=?, rotation_owner=?, last_rotated_at=?,
      expiry_alerted_at=NULL WHERE id=? AND tenant_id=?`)
      .bind(expiresAt, rotationOwner, lastRotatedAt, connectionId, tenantId),
    audit(env, tenantId, actorId, "connection.lifecycle_updated", connectionId, {
      credentialExpiresAt: expiresAt, rotationOwner, lastRotatedAt
    })
  ]);
  return { id: connectionId, name: connection.name, credentialExpiresAt: expiresAt, rotationOwner, lastRotatedAt };
}

export async function markConnectionSuccess(env: Env, tenantId: string, connectionId: string, detail: string) {
  await env.DB.prepare(`UPDATE connections SET status='healthy', last_checked_at=CURRENT_TIMESTAMP,
    last_success_at=CURRENT_TIMESTAMP, health_message=? WHERE id=? AND tenant_id=?`)
    .bind(detail.slice(0, 500), connectionId, tenantId).run();
}

export async function markConnectionAttention(env: Env, tenantId: string, connectionId: string, detail: string) {
  await env.DB.prepare(`UPDATE connections SET status='attention', last_checked_at=CURRENT_TIMESTAMP,
    health_message=? WHERE id=? AND tenant_id=?`)
    .bind(detail.slice(0, 500), connectionId, tenantId).run();
}

export async function emitConnectionExpiryAlerts(env: Env, now = new Date()) {
  const threshold = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(`SELECT id, tenant_id, name, credential_expires_at, rotation_owner
    FROM connections WHERE secret_configured=1 AND credential_expires_at IS NOT NULL
      AND datetime(credential_expires_at) <= datetime(?)
      AND (expiry_alerted_at IS NULL OR datetime(expiry_alerted_at) <= datetime(?,'-1 day'))
    ORDER BY credential_expires_at LIMIT 100`).bind(threshold, now.toISOString()).all<{
      id: string; tenant_id: string; name: string; credential_expires_at: string; rotation_owner: string | null;
    }>();
  let alerted = 0;
  for (const connection of results) {
    const expiryValue = connection.credential_expires_at;
    const expired = new Date(expiryValue.endsWith("Z") || expiryValue.includes("+")
      ? expiryValue : `${expiryValue.replace(" ", "T")}Z`) <= now;
    const detail = expired
      ? `${connection.name} credential expiry has passed. Reconnect or rotate it before dependent processes resume.`
      : `${connection.name} credential expires by ${connection.credential_expires_at}. Rotation owner: ${connection.rotation_owner ?? "unassigned"}.`;
    if (expired) await markConnectionAttention(env, connection.tenant_id, connection.id, detail);
    await emitNotification(env, connection.tenant_id, {
      eventType: "connection.credential_expiring",
      title: expired ? "Connection credential expired" : "Connection credential expires soon",
      detail,
      targetType: "connection",
      targetId: connection.id
    });
    await env.DB.prepare("UPDATE connections SET expiry_alerted_at=? WHERE id=? AND tenant_id=?")
      .bind(now.toISOString(), connection.id, connection.tenant_id).run();
    alerted += 1;
  }
  return { alerted };
}

function optionalDate(value: string | null | undefined, label: string): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} must be a valid date`);
  const pastLimit = new Date("2000-01-01T00:00:00.000Z");
  const futureLimit = new Date(Date.now() + 10 * 365 * 86_400_000);
  if (date < pastLimit || date > futureLimit) throw new Error(`${label} is outside the supported range`);
  return date.toISOString();
}

function audit(env: Env, tenantId: string, actorId: string, eventType: string, connectionId: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'connection', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, connectionId, JSON.stringify(detail));
}
