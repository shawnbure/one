import type { Env } from "./types";
import { provisionGovernanceReviews } from "./governance-reviews";
import { createProcessFromTemplate, type CreateProcessInput } from "./discovery";

export interface OnboardingManifest {
  organizationName: string;
  supportEmail: string;
  accentColor: string;
  defaultModelProfile: "fast" | "balanced" | "reasoning";
  dataRegion?: string;
}

export interface CustomerBootstrapManifest extends OnboardingManifest {
  idempotencyKey: string;
  member?: { email: string; name: string; role: "builder" | "owner" | "operator" | "reviewer" | "viewer" | "consumer" };
  firstProcess: CreateProcessInput;
}

interface BootstrapRow {
  tenant_id: string;
  idempotency_key: string;
  manifest_checksum: string;
  status: "started" | "completed" | "failed";
  member_id: string | null;
  process_id: string | null;
  started_at: string;
  completed_at: string | null;
  last_error: string | null;
}

interface ImplementationEvidenceRow {
  started_at: string;
  completed_at: string | null;
  first_run_at: string | null;
  first_readonly_connection_at: string | null;
  first_shadow_at: string | null;
}

export interface ImplementationMilestone {
  id: "baseline" | "first_run" | "readonly_connection" | "shadow";
  label: string;
  targetMinutes: number;
  achievedAt: string | null;
  elapsedMinutes: number | null;
  status: "achieved" | "pending";
}

export class BootstrapConflict extends Error {}

export async function getOnboarding(env: Env, tenantId: string) {
  const [settings, members, processes, connections, policies, bootstrap, implementationEvidence] = await Promise.all([
    env.DB.prepare("SELECT * FROM tenant_settings WHERE tenant_id = ?").bind(tenantId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM tenant_members WHERE tenant_id = ? AND status = 'active'").bind(tenantId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM agent_blueprints WHERE tenant_id = ?").bind(tenantId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM connections WHERE tenant_id = ?").bind(tenantId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM retention_policies WHERE tenant_id = ?").bind(tenantId).first<{ count: number }>(),
    env.DB.prepare(`SELECT tenant_id, status, member_id, process_id, started_at, completed_at, last_error
      FROM tenant_bootstrap_runs WHERE tenant_id = ?`).bind(tenantId).first(),
    env.DB.prepare(`SELECT b.started_at, b.completed_at,
        (SELECT MIN(e.started_at) FROM executions e
          WHERE e.tenant_id=b.tenant_id AND e.blueprint_id=b.process_id AND e.started_at >= b.started_at) first_run_at,
        (SELECT MIN(c.last_checked_at) FROM connections c
          WHERE c.tenant_id=b.tenant_id AND c.kind != 'model_provider' AND c.status='healthy'
            AND c.secret_configured=1 AND c.access_mode IN ('read','read_write')
            AND c.last_checked_at IS NOT NULL AND c.last_checked_at >= b.started_at) first_readonly_connection_at,
        (SELECT MIN(s.created_at) FROM execution_shadow_reviews s
          WHERE s.tenant_id=b.tenant_id AND s.blueprint_id=b.process_id AND s.created_at >= b.started_at) first_shadow_at
      FROM tenant_bootstrap_runs b WHERE b.tenant_id = ?`).bind(tenantId).first<ImplementationEvidenceRow>()
  ]);
  return {
    settings,
    bootstrap,
    implementationJourney: implementationMilestones(implementationEvidence),
    checklist: [
      { id: "organization", label: "Organization profile", ready: Boolean(settings) },
      { id: "members", label: "Administrator membership", ready: Number(members?.count) > 0 },
      { id: "processes", label: "First AI process", ready: Number(processes?.count) > 0 },
      { id: "connections", label: "Connection boundary", ready: Number(connections?.count) > 0 },
      { id: "retention", label: "Retention controls", ready: Number(policies?.count) > 0 }
    ]
  };
}

export function implementationMilestones(evidence: ImplementationEvidenceRow | null): ImplementationMilestone[] {
  const definitions: Array<{
    id: ImplementationMilestone["id"];
    label: string;
    targetMinutes: number;
    achievedAt: string | null;
  }> = [
    { id: "baseline", label: "Customer baseline established", targetMinutes: 60, achievedAt: evidence?.completed_at ?? null },
    { id: "first_run", label: "First governed process run", targetMinutes: 120, achievedAt: evidence?.first_run_at ?? null },
    { id: "readonly_connection", label: "First verified read-only integration", targetMinutes: 24 * 60,
      achievedAt: evidence?.first_readonly_connection_at ?? null },
    { id: "shadow", label: "First shadow-mode execution", targetMinutes: 7 * 24 * 60,
      achievedAt: evidence?.first_shadow_at ?? null }
  ];
  return definitions.map((definition) => {
    const elapsedMinutes = elapsedFrom(evidence?.started_at ?? null, definition.achievedAt);
    return {
      ...definition,
      elapsedMinutes,
      status: definition.achievedAt ? "achieved" : "pending"
    };
  });
}

function elapsedFrom(startedAt: string | null, achievedAt: string | null) {
  if (!startedAt || !achievedAt) return null;
  const elapsed = new Date(achievedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.ceil(elapsed / 60_000) : null;
}

export async function bootstrapCustomer(env: Env, tenantId: string, actorId: string, input: CustomerBootstrapManifest) {
  validateBootstrap(input);
  const canonical = {
    organizationName: input.organizationName.trim(),
    supportEmail: input.supportEmail.trim().toLowerCase(),
    accentColor: input.accentColor.toLowerCase(),
    defaultModelProfile: input.defaultModelProfile,
    dataRegion: input.dataRegion || "Cloudflare global network",
    member: input.member ? { email: input.member.email.trim().toLowerCase(), name: input.member.name.trim(), role: input.member.role } : null,
    firstProcess: input.firstProcess
  };
  const checksum = await sha256(JSON.stringify(canonical));
  let run = await env.DB.prepare("SELECT * FROM tenant_bootstrap_runs WHERE tenant_id = ?").bind(tenantId).first<BootstrapRow>();
  if (run && run.manifest_checksum !== checksum) {
    throw new BootstrapConflict("This customer environment already has a different launch manifest. Edit the live controls instead of creating a second baseline.");
  }
  if (run?.status === "completed") {
    await provisionDefaultControls(env, tenantId, actorId, run.manifest_checksum);
    return { ...(await getOnboarding(env, tenantId)), launch: launchResult(run, true) };
  }
  if (!run) {
    try {
      await env.DB.prepare(`INSERT INTO tenant_bootstrap_runs
        (tenant_id, idempotency_key, manifest_checksum, status) VALUES (?, ?, ?, 'started')`)
        .bind(tenantId, input.idempotencyKey, checksum).run();
    } catch {
      run = await env.DB.prepare("SELECT * FROM tenant_bootstrap_runs WHERE tenant_id = ?").bind(tenantId).first<BootstrapRow>();
      if (!run || run.manifest_checksum !== checksum) throw new BootstrapConflict("A different customer launch is already in progress.");
      if (run.status === "completed") {
        await provisionDefaultControls(env, tenantId, actorId, run.manifest_checksum);
        return { ...(await getOnboarding(env, tenantId)), launch: launchResult(run, true) };
      }
    }
  } else if (run.status === "failed") {
    await env.DB.prepare(`UPDATE tenant_bootstrap_runs SET status = 'started', last_error = NULL, updated_at = ?
      WHERE tenant_id = ? AND manifest_checksum = ?`).bind(new Date().toISOString(), tenantId, checksum).run();
  }

  try {
    await applyOnboarding(env, tenantId, actorId, canonical);
    await env.DB.prepare(`INSERT OR IGNORE INTO tenant_model_policies
      (tenant_id, model_id, enabled, updated_by)
      SELECT ?, model_id, 1, ? FROM model_catalog WHERE status='active'`)
      .bind(tenantId, actorId).run();
    await provisionGovernanceReviews(env, tenantId);
    await provisionDefaultControls(env, tenantId, actorId, checksum);
    let memberId = actorId;
    if (canonical.member) {
      const proposedId = `member-${checksum.slice(0, 12)}`;
      await env.DB.prepare(`INSERT INTO tenant_members (id, tenant_id, email, display_name, role, status)
        VALUES (?, ?, ?, ?, ?, 'active') ON CONFLICT(tenant_id, email) DO UPDATE SET
        display_name = excluded.display_name,
        role = CASE WHEN tenant_members.role = 'admin' THEN tenant_members.role ELSE excluded.role END,
        status = 'active'`)
        .bind(proposedId, tenantId, canonical.member.email, canonical.member.name, canonical.member.role).run();
      const member = await env.DB.prepare("SELECT id FROM tenant_members WHERE tenant_id = ? AND email = ?")
        .bind(tenantId, canonical.member.email).first<{ id: string }>();
      if (!member) throw new Error("Operating teammate membership could not be established");
      memberId = member.id;
    }
    const processId = `launch-${slug(canonical.firstProcess.name)}-${checksum.slice(0, 10)}`;
    const process = await createProcessFromTemplate(env, tenantId, actorId, canonical.firstProcess, processId);
    const completedAt = new Date().toISOString();
    await env.DB.prepare(`UPDATE tenant_bootstrap_runs SET status = 'completed', member_id = ?, process_id = ?,
      completed_at = ?, updated_at = ?, last_error = NULL WHERE tenant_id = ? AND manifest_checksum = ?`)
      .bind(memberId, process.id, completedAt, completedAt, tenantId, checksum).run();
    const completed = await env.DB.prepare("SELECT * FROM tenant_bootstrap_runs WHERE tenant_id = ?").bind(tenantId).first<BootstrapRow>();
    if (!completed) throw new Error("Customer launch evidence could not be recorded");
    return { ...(await getOnboarding(env, tenantId)), launch: launchResult(completed, false) };
  } catch (error) {
    await env.DB.prepare(`UPDATE tenant_bootstrap_runs SET status = 'failed', last_error = ?, updated_at = ?
      WHERE tenant_id = ? AND manifest_checksum = ?`)
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 500), new Date().toISOString(), tenantId, checksum).run();
    throw error;
  }
}

export async function applyOnboarding(env: Env, tenantId: string, actorId: string, input: OnboardingManifest) {
  if (!input.organizationName?.trim() || !input.supportEmail?.includes("@")) throw new Error("Organization name and support email are required");
  if (!/^#[0-9a-f]{6}$/i.test(input.accentColor)) throw new Error("Accent color must be a six-digit hex color");
  if (!["fast", "balanced", "reasoning"].includes(input.defaultModelProfile)) throw new Error("Invalid default model profile");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE tenants SET name = ? WHERE id = ?").bind(input.organizationName.trim(), tenantId),
    env.DB.prepare(`INSERT INTO tenant_settings
      (tenant_id, organization_name, support_email, accent_color, default_model_profile, data_region, initialized_at, initialized_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET organization_name=excluded.organization_name, support_email=excluded.support_email,
      accent_color=excluded.accent_color, default_model_profile=excluded.default_model_profile, data_region=excluded.data_region,
      initialized_at=COALESCE(tenant_settings.initialized_at, excluded.initialized_at), initialized_by=COALESCE(tenant_settings.initialized_by, excluded.initialized_by), updated_at=excluded.updated_at`)
      .bind(tenantId, input.organizationName.trim(), input.supportEmail.trim().toLowerCase(), input.accentColor,
        input.defaultModelProfile, input.dataRegion || "Cloudflare global network", now, actorId, now),
    env.DB.prepare(`INSERT INTO tenant_lifecycle_settings
      (tenant_id, support_owner_id, recovery_owner_id, escalation_email, recovery_review_due_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET escalation_email=excluded.escalation_email,
        updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .bind(tenantId, actorId, actorId, input.supportEmail.trim().toLowerCase(),
        new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString(), actorId, now)
  ]);
  return getOnboarding(env, tenantId);
}

export async function exportCustomerManifest(env: Env, tenantId: string) {
  const onboarding = await getOnboarding(env, tenantId);
  const [processes, members, retention] = await Promise.all([
    env.DB.prepare(`SELECT name, description, execution_profile, model_profile, autonomy, status, business_owner, department, risk_level
      FROM agent_blueprints WHERE tenant_id = ? ORDER BY name`).bind(tenantId).all(),
    env.DB.prepare("SELECT email, display_name, role, status FROM tenant_members WHERE tenant_id = ? ORDER BY email").bind(tenantId).all(),
    env.DB.prepare("SELECT name, data_class, retention_days, deletion_mode FROM retention_policies WHERE tenant_id = ? ORDER BY data_class").bind(tenantId).all()
  ]);
  return { schemaVersion: 2, exportedAt: new Date().toISOString(), settings: onboarding.settings, bootstrap: onboarding.bootstrap,
    processes: processes.results, members: members.results, retention: retention.results, secrets: "excluded" };
}

export async function exportAccessHandoff(env: Env, tenantId: string) {
  const [tenant, members] = await Promise.all([
    env.DB.prepare("SELECT name FROM tenants WHERE id = ?").bind(tenantId).first<{ name: string }>(),
    env.DB.prepare(`SELECT email, display_name, role FROM tenant_members
      WHERE tenant_id = ? AND status = 'active' ORDER BY email`).bind(tenantId).all<{
        email: string; display_name: string; role: string;
      }>()
  ]);
  const allowEmails = members.results.map((member) => member.email.trim().toLowerCase())
    .filter((email, index, values) => email.includes("@") && values.indexOf(email) === index);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tenant: { id: tenantId, name: tenant?.name ?? tenantId },
    environment: env.ENVIRONMENT,
    application: {
      domain: env.APP_DOMAIN,
      audience: env.ACCESS_AUD,
      teamDomain: env.ACCESS_TEAM_DOMAIN
    },
    policy: {
      name: `Workrr managed members · ${tenant?.name ?? tenantId}`,
      decision: "allow",
      precedence: 20,
      include: allowEmails.map((email) => ({ email: { email } }))
    },
    members: members.results,
    review: {
      memberCount: allowEmails.length,
      applyCommand: "npm run access:sync -- --manifest ./workrr-access-handoff.json --apply",
      secretsIncluded: false
    }
  };
}

function validateBootstrap(input: CustomerBootstrapManifest) {
  if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 120) throw new Error("A valid launch idempotency key is required");
  if (!input.firstProcess?.templateId || !input.firstProcess.name?.trim() || !input.firstProcess.purpose?.trim()) {
    throw new Error("A first process template, name, and purpose are required");
  }
  if (input.member && (!input.member.email.includes("@") || !input.member.name.trim() ||
      !["builder", "owner", "operator", "reviewer", "viewer", "consumer"].includes(input.member.role))) {
    throw new Error("The operating teammate requires a valid name, email, and role");
  }
}

function launchResult(run: BootstrapRow, alreadyCompleted: boolean) {
  return { status: run.status, memberId: run.member_id, processId: run.process_id, completedAt: run.completed_at, alreadyCompleted };
}

async function provisionDefaultControls(env: Env, tenantId: string, actorId: string, checksum: string) {
  const suffix = checksum.slice(0, 12);
  const existingCredential = await env.DB.prepare(`SELECT id FROM integration_credential_refs
    WHERE tenant_id = ? AND secret_binding = 'NOTIFICATION_WEBHOOK_SECRET'`).bind(tenantId).first<{ id: string }>();
  const credentialId = existingCredential?.id ?? `credential-notification-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO connections
      (id, tenant_id, name, kind, owner, status, access_mode, scopes_json, secret_configured, last_checked_at)
      SELECT ?, ?, 'Cloudflare Workers AI', 'model_provider', 'Platform Administration', 'healthy', 'read_write',
        '["model:invoke"]', 1, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (SELECT 1 FROM connections WHERE tenant_id = ? AND kind = 'model_provider' AND name = 'Cloudflare Workers AI')`)
      .bind(`conn-workers-ai-${suffix}`, tenantId, tenantId),
    env.DB.prepare(`INSERT INTO retention_policies (id, tenant_id, name, data_class, retention_days, deletion_mode)
      SELECT ?, ?, 'Operational records', 'internal', 365, 'scheduled_delete'
      WHERE NOT EXISTS (SELECT 1 FROM retention_policies WHERE tenant_id = ? AND data_class = 'internal')`)
      .bind(`retention-operational-${suffix}`, tenantId, tenantId),
    env.DB.prepare(`INSERT INTO retention_policies (id, tenant_id, name, data_class, retention_days, deletion_mode)
      SELECT ?, ?, 'Agent conversations', 'confidential', 90, 'agent_and_audit_delete'
      WHERE NOT EXISTS (SELECT 1 FROM retention_policies WHERE tenant_id = ? AND data_class = 'confidential')`)
      .bind(`retention-conversation-${suffix}`, tenantId, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO tenant_retention_controls
      (tenant_id, updated_by) VALUES (?, ?)`).bind(tenantId, actorId),
    env.DB.prepare(`INSERT OR IGNORE INTO tenant_budgets
      (tenant_id, monthly_limit_usd, warning_percent, hard_limit, updated_by) VALUES (?, 25, 80, 0, ?)`)
      .bind(tenantId, actorId),
    env.DB.prepare(`INSERT OR IGNORE INTO tenant_operating_controls
      (tenant_id, mode, updated_by) VALUES (?, 'active', ?)`).bind(tenantId, actorId),
    env.DB.prepare(`INSERT OR IGNORE INTO integration_credential_refs
      (id, tenant_id, name, provider, secret_binding, purpose)
      VALUES (?, ?, 'Outbound webhook signing key', 'generic_webhook', 'NOTIFICATION_WEBHOOK_SECRET',
        'Signs Workrr notification deliveries with HMAC-SHA256')`)
      .bind(credentialId, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity)
      VALUES (?, ?, 'approval.pending', 'in_app', NULL, 1, 'warning')`).bind(`notify-approval-${suffix}`, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity)
      VALUES (?, ?, 'execution.failed', 'in_app', NULL, 1, 'critical')`).bind(`notify-execution-${suffix}`, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity)
      VALUES (?, ?, 'queue.retry_exhausted', 'in_app', NULL, 1, 'critical')`).bind(`notify-queue-${suffix}`, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity)
      VALUES (?, ?, 'incident.emergency_stop', 'in_app', NULL, 1, 'critical')`).bind(`notify-incident-${suffix}`, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity, owner_id,
       acknowledgement_required, escalation_minutes)
      VALUES (?, ?, 'help.request.created', 'in_app', NULL, 1, 'warning',
        (SELECT support_owner_id FROM tenant_lifecycle_settings WHERE tenant_id = ?), 1, 1440)`)
      .bind(`notify-help-request-${suffix}`, tenantId, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity, owner_id,
       acknowledgement_required, escalation_minutes)
      VALUES (?, ?, 'value.target_review_due', 'in_app', NULL, 1, 'warning',
        COALESCE(
          (SELECT support_owner_id FROM tenant_lifecycle_settings WHERE tenant_id = ?),
          (SELECT id FROM tenant_members WHERE tenant_id = ? AND status = 'active'
           AND role IN ('owner', 'admin', 'operator')
           ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1)
        ), 1, 1440)`)
      .bind(`notify-value-target-review-${suffix}`, tenantId, tenantId, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity, owner_id,
       acknowledgement_required, escalation_minutes)
      VALUES (?, ?, 'usage.budget_threshold', 'in_app', NULL, 1, 'warning',
        COALESCE(
          (SELECT support_owner_id FROM tenant_lifecycle_settings WHERE tenant_id = ?),
          (SELECT id FROM tenant_members WHERE tenant_id = ? AND status = 'active'
           AND role IN ('owner', 'admin', 'operator')
           ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1)
        ), 1, 1440)`)
      .bind(`notify-budget-threshold-${suffix}`, tenantId, tenantId, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity, owner_id,
       acknowledgement_required, escalation_minutes)
      VALUES (?, ?, 'platform.maintenance_degraded', 'in_app', NULL, 1, 'critical',
        COALESCE(
          (SELECT recovery_owner_id FROM tenant_lifecycle_settings WHERE tenant_id = ?),
          (SELECT support_owner_id FROM tenant_lifecycle_settings WHERE tenant_id = ?),
          (SELECT id FROM tenant_members WHERE tenant_id = ? AND status = 'active'
           AND role IN ('owner', 'admin', 'operator')
           ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1)
        ), 1, 60)`)
      .bind(`notify-maintenance-degraded-${suffix}`, tenantId, tenantId, tenantId, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity, owner_id,
       acknowledgement_required, escalation_minutes)
      VALUES (?, ?, 'agent.follow_up_due', 'in_app', NULL, 1, 'warning',
        COALESCE(
          (SELECT support_owner_id FROM tenant_lifecycle_settings WHERE tenant_id = ?),
          (SELECT recovery_owner_id FROM tenant_lifecycle_settings WHERE tenant_id = ?),
          (SELECT id FROM tenant_members WHERE tenant_id = ? AND status = 'active'
           AND role IN ('owner', 'admin', 'operator')
           ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1)
        ), 1, 1440)`)
      .bind(`notify-agent-follow-up-${suffix}`, tenantId, tenantId, tenantId, tenantId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity, credential_ref_id)
      VALUES (?, ?, 'execution.failed', 'webhook', NULL, 0, 'critical', ?)`)
      .bind(`notify-execution-webhook-${suffix}`, tenantId, credentialId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity, credential_ref_id)
      VALUES (?, ?, 'value.target_review_due', 'webhook', NULL, 0, 'warning', ?)`)
      .bind(`notify-value-target-review-webhook-${suffix}`, tenantId, credentialId),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity)
      VALUES (?, ?, 'value.target_review_due', 'email', NULL, 0, 'warning')`)
      .bind(`notify-value-target-review-email-${suffix}`, tenantId),
    ...[
      ["approval.pending", "warning", "approval"],
      ["execution.failed", "critical", "execution"],
      ["queue.retry_exhausted", "critical", "queue"],
    ].map(([eventType, severity, name]) => env.DB.prepare(`INSERT OR IGNORE INTO notification_policies
      (id, tenant_id, event_type, channel, destination, enabled, severity)
      VALUES (?, ?, ?, 'email', NULL, 0, ?)`)
      .bind(`notify-${name}-email-${suffix}`, tenantId, eventType, severity)),
    ...[
      ["email", "Email addresses", "redact"],
      ["phone", "Phone numbers", "redact"],
      ["ssn", "US Social Security numbers", "block"],
      ["payment_card", "Payment card numbers", "block"],
      ["api_secret", "API keys and secrets", "block"],
      ["ip_address", "IP addresses", "audit"]
    ].map(([detector, label, action]) => env.DB.prepare(`INSERT OR IGNORE INTO dlp_rules
      (id, tenant_id, detector, label, action, direction, enabled, updated_by)
      VALUES (?, ?, ?, ?, ?, 'both', 1, ?)`)
      .bind(`dlp-${detector}-${suffix}`, tenantId, detector, label, action, actorId))
  ]);
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "process";
}
