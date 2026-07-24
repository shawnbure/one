import type { Env } from "./types";

const evidenceWindowDays = 30;

export async function getDeploymentVerification(env: Env, tenantId: string) {
  const [principals, latestSmoke] = await Promise.all([
    env.DB.prepare(`SELECT id, display_name, role, status, last_seen_at, credential_expires_at
      FROM access_service_principals
      WHERE tenant_id=? AND status='active' AND role='operator'
        AND credential_expires_at IS NOT NULL AND datetime(credential_expires_at) > datetime('now')
      ORDER BY last_seen_at DESC`).bind(tenantId).all<{
        id: string; display_name: string; role: string; status: string; last_seen_at: string | null;
        credential_expires_at: string;
      }>(),
    env.DB.prepare(`SELECT deleted.target_id fixture_id, deleted.actor_id principal_id,
      principal.display_name principal_name, created.created_at started_at,
      deleted.created_at completed_at
      FROM audit_events deleted
      JOIN audit_events created ON created.tenant_id=deleted.tenant_id
        AND created.target_type='smoke_fixture' AND created.target_id=deleted.target_id
        AND created.event_type='smoke_fixture.created' AND created.actor_id=deleted.actor_id
      JOIN access_service_principals principal ON principal.id=deleted.actor_id
        AND principal.tenant_id=deleted.tenant_id AND principal.status='active'
        AND principal.credential_expires_at IS NOT NULL
        AND datetime(principal.credential_expires_at) > datetime('now')
      WHERE deleted.tenant_id=? AND deleted.target_type='smoke_fixture'
        AND deleted.event_type='smoke_fixture.deleted'
      ORDER BY datetime(deleted.created_at) DESC LIMIT 1`).bind(tenantId).first<{
        fixture_id: string; principal_id: string; principal_name: string;
        started_at: string; completed_at: string;
      }>()
  ]);
  const completedAt = latestSmoke?.completed_at ?? null;
  const recent = Boolean(completedAt &&
    Date.parse(completedAt) >= Date.now() - evidenceWindowDays * 86_400_000);
  const activePrincipals = principals.results;
  return {
    evidenceWindowDays,
    status: recent ? "verified" : activePrincipals.length ? "verification_due" : "principal_required",
    activeOperatorPrincipals: activePrincipals.length,
    lastVerifiedAt: completedAt,
    lastVerifiedBy: latestSmoke?.principal_name ?? null,
    checks: [
      {
        id: "service-principal",
        label: "Access operator service principal",
        ready: activePrincipals.length > 0,
        detail: activePrincipals.length
          ? `${activePrincipals.length} active operator principal${activePrincipals.length === 1 ? "" : "s"} registered`
          : "Register a least-privilege Cloudflare Access service token"
      },
      {
        id: "live-smoke",
        label: "Live tenant-boundary smoke verification",
        ready: recent,
        detail: recent && latestSmoke
          ? `Passed ${completedAt} as ${latestSmoke.principal_name}`
          : completedAt
            ? `Last passed ${completedAt}; verification is older than ${evidenceWindowDays} days`
            : "No complete service-principal create/read/delete smoke cycle recorded"
      }
    ]
  };
}
