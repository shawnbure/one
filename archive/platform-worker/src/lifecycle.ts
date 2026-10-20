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

export interface HandoffCheckInput {
  status: "open" | "confirmed";
  evidence: string;
  revision: number;
}

const handoffDefinitions = [
  ["customer_acceptance", "Customer acceptance", "Customer owner reviewed the process purpose, boundaries, and expected outcome."],
  ["data_owner_approval", "Data owner approval", "The accountable owner approved data sources, sensitivity, retention, and permitted use."],
  ["operator_training", "Operator training", "Named operators completed the approval, pause, recovery, and escalation walkthrough."],
  ["support_handoff", "Support handoff", "Support ownership, escalation route, maintenance window, and runbooks were transferred."],
  ["recovery_exercise", "Recovery exercise", "The team exercised a failed run from diagnosis through verified recovery."],
] as const;

export async function getManagedLifecycle(env: Env, tenantId: string) {
  const [settings, counts, controls, enabledExternal, expiredCredentials, unownedAlerts, activeRelease,
    openCritical, members, handoffRows, maintenanceRows] = await Promise.all([
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
    ,
    env.DB.prepare(`SELECT h.check_id, h.status, h.evidence, h.confirmed_by, h.confirmed_at,
      h.revision, h.updated_at, m.display_name confirmed_by_name
      FROM tenant_handoff_checks h
      LEFT JOIN tenant_members m ON m.tenant_id=h.tenant_id AND m.id=h.confirmed_by
      WHERE h.tenant_id=?`).bind(tenantId).all<Record<string, unknown>>()
    ,
    env.DB.prepare(`SELECT id, started_at, completed_at, status, task_count, failed_count, task_results_json
      FROM platform_maintenance_runs ORDER BY started_at DESC LIMIT 12`).all<{
        id: string; started_at: string; completed_at: string | null; status: "running" | "healthy" | "degraded";
        task_count: number; failed_count: number; task_results_json: string;
      }>()
  ]);
  const latestMaintenance = maintenanceRows.results[0];
  const maintenanceCurrent = latestMaintenance ? (
    new Date(String(latestMaintenance.started_at)).getTime() >= Date.now() - 2 * 60 * 60_000 &&
    latestMaintenance.status === "healthy"
  ) : false;
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
    check("maintenance", "Scheduled maintenance", maintenanceCurrent, "operations",
      latestMaintenance
        ? `${Number(latestMaintenance.failed_count)} of ${Number(latestMaintenance.task_count)} tasks failed in the latest run.`
        : "No completed hourly maintenance evidence is available yet."),
    check("active_release", "Published operating process", Number(activeRelease?.count) > 0, "release",
      "Publish and activate at least one evaluated process before handoff."),
    check("incidents", "No unresolved critical incident", Number(openCritical?.count) === 0, "recovery",
      `${Number(openCritical?.count)} critical incidents remain unresolved.`),
    check("access", "Cloudflare Access boundary", Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD), "security",
      "Configure the Access team domain and application audience.")
  ];
  const handoffById = new Map(handoffRows.results.map((row) => [String(row.check_id), row]));
  const handoffChecks = handoffDefinitions.map(([id, label, detail]) => {
    const row = handoffById.get(id);
    return {
      id, label, detail,
      status: row?.status === "confirmed" ? "confirmed" as const : "open" as const,
      evidence: row?.evidence ? String(row.evidence) : null,
      confirmedBy: row?.confirmed_by ? String(row.confirmed_by) : null,
      confirmedByName: row?.confirmed_by_name ? String(row.confirmed_by_name) : null,
      confirmedAt: row?.confirmed_at ? String(row.confirmed_at) : null,
      revision: Number(row?.revision ?? 0),
      updatedAt: row?.updated_at ? String(row.updated_at) : null
    };
  });
  const automatedReady = checks.every((item) => item.ready);
  const humanReady = handoffChecks.every((item) => item.status === "confirmed");
  return {
    settings: settings ?? null,
    members: members.results,
    preflight: {
      status: checks.every((item) => item.ready) ? "ready" : "action_required",
      ready: checks.filter((item) => item.ready).length,
      total: checks.length,
      checks
    },
    handoff: {
      status: automatedReady && humanReady ? "ready" as const : "action_required" as const,
      automatedReady,
      confirmed: handoffChecks.filter((item) => item.status === "confirmed").length,
      total: handoffChecks.length,
      checks: handoffChecks
    },
    environment: { name: env.ENVIRONMENT, domain: env.APP_DOMAIN, accessTeamDomain: env.ACCESS_TEAM_DOMAIN },
    counts: counts ?? {},
    operatingControl: controls ?? null,
    maintenanceRuns: maintenanceRows.results.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status,
      taskCount: Number(row.task_count),
      failedCount: Number(row.failed_count),
      tasks: parseMaintenanceTasks(row.task_results_json)
    }))
  };
}

function parseMaintenanceTasks(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).map((item) => ({
      name: String(item?.name ?? "unknown").slice(0, 80),
      status: item?.status === "failed" ? "failed" as const : "healthy" as const,
      durationMs: Math.max(0, Number(item?.durationMs ?? 0)),
      error: item?.status === "failed" ? String(item?.error ?? "Task failed").slice(0, 300) : undefined
    }));
  } catch {
    return [];
  }
}

export async function updateHandoffCheck(
  env: Env, tenantId: string, actorId: string, checkId: string, input: HandoffCheckInput,
) {
  if (!handoffDefinitions.some(([id]) => id === checkId)) throw new Error("Unknown handoff check");
  if (!["open", "confirmed"].includes(input.status)) throw new Error("Handoff status must be open or confirmed");
  if (!Number.isInteger(input.revision) || input.revision < 0) throw new Error("A valid handoff revision is required");
  const evidence = input.evidence?.trim() ?? "";
  if (evidence.length > 1500) throw new Error("Handoff evidence must be 1,500 characters or fewer");
  if (input.status === "confirmed" && evidence.length < 10) {
    throw new Error("Confirmed handoff checks require specific evidence");
  }
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(`SELECT revision FROM tenant_handoff_checks
    WHERE tenant_id=? AND check_id=?`).bind(tenantId, checkId).first<{ revision: number }>();
  if (Number(existing?.revision ?? 0) !== input.revision) {
    throw new HandoffConflict("This handoff evidence changed. Reload before updating it.");
  }
  const nextRevision = input.revision + 1;
  const result = existing
    ? await env.DB.prepare(`UPDATE tenant_handoff_checks SET status=?, evidence=?,
        confirmed_by=?, confirmed_at=?, revision=?, updated_at=?
        WHERE tenant_id=? AND check_id=? AND revision=?`)
      .bind(input.status, evidence || null, input.status === "confirmed" ? actorId : null,
        input.status === "confirmed" ? now : null, nextRevision, now, tenantId, checkId, input.revision).run()
    : await env.DB.prepare(`INSERT INTO tenant_handoff_checks
        (tenant_id, check_id, status, evidence, confirmed_by, confirmed_at, revision, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(tenantId, checkId, input.status, evidence || null,
        input.status === "confirmed" ? actorId : null, input.status === "confirmed" ? now : null,
        nextRevision, now).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new HandoffConflict("This handoff evidence changed. Reload before updating it.");
  }
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, 'lifecycle.handoff_updated', 'handoff_check', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, checkId, JSON.stringify({
      status: input.status, evidenceRecorded: Boolean(evidence), revision: nextRevision
    })).run();
  return getManagedLifecycle(env, tenantId);
}

export class HandoffConflict extends Error {}

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
    handoff: lifecycle.handoff,
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
