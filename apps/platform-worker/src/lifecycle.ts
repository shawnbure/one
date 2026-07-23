import type { Env } from "./types";

export interface LifecycleInput {
  supportOwnerId: string;
  recoveryOwnerId: string;
  escalationEmail: string;
  maintenanceDayUtc: number;
  maintenanceHourUtc: number;
  recoveryReviewDueAt: string | null;
  supportNotes: string;
}

export async function getManagedLifecycle(env: Env, tenantId: string) {
  const [settings, counts, controls, enabledExternal, expiredCredentials, unownedAlerts, activeRelease,
    openCritical, members] = await Promise.all([
    env.DB.prepare(`SELECT l.*, s.organization_name, s.support_email,
      so.display_name support_owner_name, ro.display_name recovery_owner_name
      FROM tenant_lifecycle_settings l
      JOIN tenant_settings s ON s.tenant_id=l.tenant_id
      LEFT JOIN tenant_members so ON so.id=l.support_owner_id AND so.tenant_id=l.tenant_id
      LEFT JOIN tenant_members ro ON ro.id=l.recovery_owner_id AND ro.tenant_id=l.tenant_id
      WHERE l.tenant_id=?`).bind(tenantId).first<Record<string, unknown>>(),
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM agent_blueprints WHERE tenant_id=?) processes,
      (SELECT COUNT(*) FROM tenant_members WHERE tenant_id=? AND status='active') members,
      (SELECT COUNT(*) FROM connections WHERE tenant_id=?) connections,
      (SELECT COUNT(*) FROM knowledge_sources WHERE tenant_id=? AND status NOT IN ('deleted')) knowledge_sources,
      (SELECT COUNT(*) FROM executions WHERE tenant_id=?) executions,
      (SELECT COUNT(*) FROM audit_events WHERE tenant_id=?) audit_events,
      (SELECT COUNT(*) FROM retention_policies WHERE tenant_id=?) retention_policies,
      (SELECT COUNT(*) FROM help_requests WHERE tenant_id=? AND status!='resolved') open_help_requests,
      (SELECT COUNT(*) FROM help_requests WHERE tenant_id=? AND status!='resolved'
        AND datetime(due_at)<datetime('now')) overdue_help_requests`)
      .bind(tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId)
      .first<Record<string, number>>(),
    env.DB.prepare("SELECT mode, reason, updated_at FROM tenant_operating_controls WHERE tenant_id=?")
      .bind(tenantId).first<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COUNT(*) count FROM notification_policies p
      WHERE p.tenant_id=? AND p.enabled=1 AND p.channel IN ('email','webhook')
      AND (p.destination IS NULL OR (p.channel='webhook' AND NOT EXISTS (
        SELECT 1 FROM integration_credential_refs r WHERE r.id=p.credential_ref_id AND r.tenant_id=p.tenant_id
          AND r.status='configured')) OR (p.channel='email' AND NOT EXISTS (
        SELECT 1 FROM oauth_connections o WHERE o.tenant_id=p.tenant_id AND o.provider='microsoft'
          AND o.status='connected' AND LOWER(o.scopes_json) LIKE '%mail.send%')))`)
      .bind(tenantId).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) count FROM connections WHERE tenant_id=? AND
      (status IN ('expired','invalid') OR (credential_expires_at IS NOT NULL AND datetime(credential_expires_at)<=datetime('now')))`)
      .bind(tenantId).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) count FROM notification_policies WHERE tenant_id=? AND channel='in_app'
      AND enabled=1 AND acknowledgement_required=1 AND owner_id IS NULL`).bind(tenantId).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) count FROM agent_blueprints b WHERE b.tenant_id=? AND b.status='active'
      AND EXISTS (SELECT 1 FROM prompt_releases r WHERE r.blueprint_id=b.id
        AND r.status='published')`).bind(tenantId).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) count FROM incidents WHERE tenant_id=? AND severity='critical'
      AND status NOT IN ('resolved','closed')`).bind(tenantId).first<{ count: number }>(),
    env.DB.prepare(`SELECT id, display_name, email, role FROM tenant_members WHERE tenant_id=? AND status='active'
      AND role IN ('admin','owner','operator') ORDER BY display_name`).bind(tenantId).all()
  ]);
  const checks = [
    check("profile", "Customer profile", Boolean(settings), "identity", "Organization and support configuration are persisted."),
    check("support_owner", "Named support owner", Boolean(settings?.support_owner_id), "ownership", "Assign the person accountable for day-to-day operation."),
    check("recovery_owner", "Named recovery owner", Boolean(settings?.recovery_owner_id), "ownership", "Assign the person authorized to coordinate recovery."),
    check("recovery_review", "Recovery review current",
      Boolean(settings?.recovery_review_due_at) && new Date(String(settings?.recovery_review_due_at)).getTime() > Date.now(),
      "recovery", "Set a future review date and exercise the recovery runbook before it expires."),
    check("retention", "Retention policy", Number(counts?.retention_policies) > 0, "data", "Define lifecycle and deletion behavior for customer data."),
    check("owned_alerts", "Operational alert ownership", Number(unownedAlerts?.count) === 0, "operations",
      `${Number(unownedAlerts?.count)} acknowledgement policies are unowned.`),
    check("support_sla", "Support response SLA", Number(counts?.overdue_help_requests) === 0, "operations",
      `${Number(counts?.overdue_help_requests ?? 0)} help requests are overdue.`),
    check("credentials", "Credential lifecycle", Number(expiredCredentials?.count) === 0, "security",
      `${Number(expiredCredentials?.count)} credentials are expired or invalid.`),
    check("external_routes", "Enabled delivery routes", Number(enabledExternal?.count) === 0, "operations",
      `${Number(enabledExternal?.count)} enabled routes lack a destination or ready credential.`),
    check("active_release", "Published operating process", Number(activeRelease?.count) > 0, "release",
      "Publish and activate at least one evaluated process before handoff."),
    check("incidents", "No unresolved critical incident", Number(openCritical?.count) === 0, "recovery",
      `${Number(openCritical?.count)} critical incidents remain unresolved.`),
    check("access", "Cloudflare Access boundary", Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD), "security",
      "Configure the Access team domain and application audience.")
  ];
  return {
    settings: settings ?? null,
    members: members.results,
    preflight: {
      status: checks.every((item) => item.ready) ? "ready" : "action_required",
      ready: checks.filter((item) => item.ready).length,
      total: checks.length,
      checks
    },
    environment: { name: env.ENVIRONMENT, domain: env.APP_DOMAIN, accessTeamDomain: env.ACCESS_TEAM_DOMAIN },
    counts: counts ?? {},
    operatingControl: controls ?? null
  };
}

export async function updateManagedLifecycle(
  env: Env, tenantId: string, actorId: string, input: LifecycleInput,
) {
  if (!input.escalationEmail?.trim().match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/) || input.escalationEmail.length > 254) {
    throw new Error("A valid escalation email is required");
  }
  if (![input.maintenanceDayUtc, input.maintenanceHourUtc].every(Number.isInteger) ||
      input.maintenanceDayUtc < 0 || input.maintenanceDayUtc > 6 ||
      input.maintenanceHourUtc < 0 || input.maintenanceHourUtc > 23) {
    throw new Error("Maintenance day and hour must be valid UTC values");
  }
  if (input.supportNotes.trim().length > 2000) throw new Error("Support notes must be 2,000 characters or fewer");
  const ownerIds = [...new Set([input.supportOwnerId, input.recoveryOwnerId])];
  if (ownerIds.some((id) => !id)) throw new Error("Support and recovery owners are required");
  const placeholders = ownerIds.map(() => "?").join(",");
  const ownerCount = await env.DB.prepare(`SELECT COUNT(*) count FROM tenant_members WHERE tenant_id=?
    AND id IN (${placeholders}) AND status='active' AND role IN ('admin','owner','operator')`)
    .bind(tenantId, ...ownerIds).first<{ count: number }>();
  if (Number(ownerCount?.count) !== ownerIds.length) {
    throw new Error("Lifecycle owners must be active administrators, owners, or operators in this customer");
  }
  let recoveryReviewDueAt: string | null = null;
  if (input.recoveryReviewDueAt) {
    const due = new Date(input.recoveryReviewDueAt);
    if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now() ||
        due.getTime() > Date.now() + 366 * 24 * 60 * 60_000) {
      throw new Error("Recovery review must be a future date within one year");
    }
    recoveryReviewDueAt = due.toISOString();
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO tenant_lifecycle_settings
      (tenant_id, support_owner_id, recovery_owner_id, escalation_email, maintenance_day_utc,
       maintenance_hour_utc, recovery_review_due_at, support_notes, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET support_owner_id=excluded.support_owner_id,
      recovery_owner_id=excluded.recovery_owner_id, escalation_email=excluded.escalation_email,
      maintenance_day_utc=excluded.maintenance_day_utc, maintenance_hour_utc=excluded.maintenance_hour_utc,
      recovery_review_due_at=excluded.recovery_review_due_at, support_notes=excluded.support_notes,
      updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .bind(tenantId, input.supportOwnerId, input.recoveryOwnerId, input.escalationEmail.trim().toLowerCase(),
        input.maintenanceDayUtc, input.maintenanceHourUtc, recoveryReviewDueAt,
        input.supportNotes.trim() || null, actorId, now),
    env.DB.prepare(`INSERT INTO audit_events
      (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
      VALUES (?, ?, ?, 'lifecycle.settings_updated', 'tenant', ?, ?)`)
      .bind(crypto.randomUUID(), tenantId, actorId, tenantId, JSON.stringify({
        supportOwnerId: input.supportOwnerId, recoveryOwnerId: input.recoveryOwnerId,
        maintenanceDayUtc: input.maintenanceDayUtc, maintenanceHourUtc: input.maintenanceHourUtc,
        recoveryReviewDueAt, escalationConfigured: true
      }))
  ]);
  return getManagedLifecycle(env, tenantId);
}

export async function exportSupportBundle(env: Env, tenantId: string) {
  const lifecycle = await getManagedLifecycle(env, tenantId);
  const [connections, policies, incidents, failures] = await Promise.all([
    env.DB.prepare(`SELECT name, kind, status, access_mode, credential_expires_at,
      last_success_at FROM connections WHERE tenant_id=? ORDER BY name`)
      .bind(tenantId).all(),
    env.DB.prepare(`SELECT event_type, channel, enabled, severity, destination IS NOT NULL destination_configured,
      acknowledgement_required, escalation_minutes, quiet_hours_enabled, digest_mode
      FROM notification_policies WHERE tenant_id=? ORDER BY event_type, channel`).bind(tenantId).all(),
    env.DB.prepare(`SELECT id, title, severity, category, status, owner_id, opened_at, resolved_at
      FROM incidents WHERE tenant_id=? ORDER BY opened_at DESC LIMIT 25`).bind(tenantId).all(),
    env.DB.prepare(`SELECT status, COUNT(*) count FROM executions WHERE tenant_id=? AND status IN ('failed','blocked')
      AND datetime(started_at)>=datetime('now','-7 days') GROUP BY status`).bind(tenantId).all()
  ]);
  return {
    schemaVersion: 1,
    bundleType: "workrr-redacted-support",
    generatedAt: new Date().toISOString(),
    environment: lifecycle.environment,
    preflight: lifecycle.preflight,
    lifecycle: lifecycle.settings,
    counts: lifecycle.counts,
    operatingControl: lifecycle.operatingControl,
    connections: connections.results,
    notificationPolicies: policies.results,
    recentIncidents: incidents.results,
    sevenDayExecutionExceptions: failures.results,
    exclusions: [
      "credentials and tokens", "notification destinations", "prompt and knowledge content",
      "execution inputs and outputs", "member email addresses", "API request and response bodies"
    ]
  };
}

function check(id: string, label: string, ready: boolean, category: string, detail: string) {
  return { id, label, ready, category, detail };
}
