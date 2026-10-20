import type { Env } from "./types";
import { emitNotification } from "./notifications";

export async function emitServicePrincipalExpiryAlerts(env: Env, now = new Date()) {
  const threshold = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(`SELECT id, tenant_id, display_name, credential_expires_at,
      rotation_owner
    FROM access_service_principals
    WHERE status='active' AND credential_expires_at IS NOT NULL
      AND datetime(credential_expires_at) <= datetime(?)
    ORDER BY datetime(credential_expires_at) LIMIT 100`)
    .bind(threshold).all<{
      id: string; tenant_id: string; display_name: string;
      credential_expires_at: string; rotation_owner: string | null;
    }>();
  let emitted = 0;
  for (const principal of results) {
    const expired = Date.parse(principal.credential_expires_at) <= now.getTime();
    const stage = expired ? "expired" : "warning";
    const claim = await env.DB.prepare(`INSERT OR IGNORE INTO service_principal_expiry_alerts
      (principal_id, tenant_id, expires_at, stage) VALUES (?, ?, ?, ?)`)
      .bind(principal.id, principal.tenant_id, principal.credential_expires_at, stage).run();
    if (claim.meta.changes !== 1) continue;
    try {
      const ids = await emitNotification(env, principal.tenant_id, {
        eventType: "access.service_principal_expiring",
        title: expired ? "Machine identity credential expired" : "Machine identity rotation due",
        detail: expired
          ? `${principal.display_name} expired at ${principal.credential_expires_at} and can no longer authenticate. Register or rotate its Cloudflare Access service token.`
          : `${principal.display_name} expires at ${principal.credential_expires_at}. Complete rotation before the customer automation loses access.`,
        targetType: "service_principal",
        targetId: principal.id,
      });
      if (!ids.length) {
        await releaseClaim(env, principal.id, principal.credential_expires_at, stage);
      } else emitted += ids.length;
    } catch (error) {
      await releaseClaim(env, principal.id, principal.credential_expires_at, stage);
      throw error;
    }
  }
  return { considered: results.length, emitted };
}

export function boundedCredentialExpiry(value: unknown, now = new Date()) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Credential expiry is required");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now.getTime() + 60_000) {
    throw new Error("Credential expiry must be in the future");
  }
  if (parsed.getTime() > now.getTime() + 366 * 86_400_000) {
    throw new Error("Credential expiry cannot be more than 366 days away");
  }
  return parsed.toISOString();
}

async function releaseClaim(env: Env, principalId: string, expiresAt: string, stage: string) {
  await env.DB.prepare(`DELETE FROM service_principal_expiry_alerts
    WHERE principal_id=? AND expires_at=? AND stage=?`).bind(principalId, expiresAt, stage).run();
}
