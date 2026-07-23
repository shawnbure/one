import type { Env } from "./types";

type ConfigurationPackage = {
  schema: "workrr-configuration/v1";
  exportedAt: string;
  source: { environment: string; tenantId: string };
  organization: {
    organizationName: string; supportEmail: string; accentColor: string;
    defaultModelProfile: string; dataRegion: string;
  };
  lifecycle: {
    escalationEmail: string; maintenanceDayUtc: number; maintenanceHourUtc: number;
    recoveryReviewDueAt: string | null;
  } | null;
  retention: {
    conversationDays: number; executionDays: number; approvalDays: number;
    notificationDays: number; helpRequestDays: number; apiLogDays: number;
  } | null;
  dlpRules: Array<{
    detector: string; action: string; direction: string; enabled: boolean;
  }>;
  notificationPolicies: Array<{
    eventType: string; channel: string; enabled: boolean; severity: string;
    acknowledgementRequired: boolean; escalationMinutes: number;
    quietHoursEnabled: boolean; quietStartHourUtc: number; quietEndHourUtc: number;
    criticalBypass: boolean; digestMode: string; digestHourUtc: number;
  }>;
  exclusions: string[];
};

const detectors = ["email", "phone", "ssn", "payment_card", "api_secret", "ip_address"];
const actions = ["audit", "redact", "block"];
const directions = ["input", "output", "both"];
const channels = ["in_app", "email", "webhook"];
const severities = ["info", "warning", "critical"];
const digests = ["immediate", "hourly", "daily"];
const models = ["fast", "balanced", "reasoning"];

export async function exportConfigurationPackage(env: Env, tenantId: string): Promise<ConfigurationPackage> {
  const [organization, lifecycle, retention, dlp, notifications] = await Promise.all([
    env.DB.prepare(`SELECT organization_name, support_email, accent_color, default_model_profile, data_region
      FROM tenant_settings WHERE tenant_id=?`).bind(tenantId).first<Record<string, unknown>>(),
    env.DB.prepare(`SELECT escalation_email, maintenance_day_utc, maintenance_hour_utc, recovery_review_due_at
      FROM tenant_lifecycle_settings WHERE tenant_id=?`).bind(tenantId).first<Record<string, unknown>>(),
    env.DB.prepare(`SELECT conversation_days, execution_days, approval_days, notification_days,
      help_request_days, api_log_days FROM tenant_retention_controls WHERE tenant_id=?`)
      .bind(tenantId).first<Record<string, unknown>>(),
    env.DB.prepare(`SELECT detector, action, direction, enabled FROM dlp_rules
      WHERE tenant_id=? ORDER BY detector`).bind(tenantId).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT event_type, channel, enabled, severity, acknowledgement_required,
      escalation_minutes, quiet_hours_enabled, quiet_start_hour_utc, quiet_end_hour_utc,
      critical_bypass, digest_mode, digest_hour_utc FROM notification_policies
      WHERE tenant_id=? ORDER BY event_type, channel`).bind(tenantId).all<Record<string, unknown>>()
  ]);
  if (!organization) throw new Error("Customer organization settings are not initialized");
  return {
    schema: "workrr-configuration/v1",
    exportedAt: new Date().toISOString(),
    source: { environment: env.ENVIRONMENT, tenantId },
    organization: {
      organizationName: String(organization.organization_name),
      supportEmail: String(organization.support_email),
      accentColor: String(organization.accent_color),
      defaultModelProfile: String(organization.default_model_profile),
      dataRegion: String(organization.data_region)
    },
    lifecycle: lifecycle ? {
      escalationEmail: String(lifecycle.escalation_email),
      maintenanceDayUtc: Number(lifecycle.maintenance_day_utc),
      maintenanceHourUtc: Number(lifecycle.maintenance_hour_utc),
      recoveryReviewDueAt: lifecycle.recovery_review_due_at ? String(lifecycle.recovery_review_due_at) : null
    } : null,
    retention: retention ? {
      conversationDays: Number(retention.conversation_days), executionDays: Number(retention.execution_days),
      approvalDays: Number(retention.approval_days), notificationDays: Number(retention.notification_days),
      helpRequestDays: Number(retention.help_request_days), apiLogDays: Number(retention.api_log_days)
    } : null,
    dlpRules: dlp.results.map((row) => ({
      detector: String(row.detector), action: String(row.action), direction: String(row.direction),
      enabled: Boolean(row.enabled)
    })),
    notificationPolicies: notifications.results.map((row) => ({
      eventType: String(row.event_type), channel: String(row.channel), enabled: Boolean(row.enabled),
      severity: String(row.severity), acknowledgementRequired: Boolean(row.acknowledgement_required),
      escalationMinutes: Number(row.escalation_minutes), quietHoursEnabled: Boolean(row.quiet_hours_enabled),
      quietStartHourUtc: Number(row.quiet_start_hour_utc), quietEndHourUtc: Number(row.quiet_end_hour_utc),
      criticalBypass: Boolean(row.critical_bypass), digestMode: String(row.digest_mode),
      digestHourUtc: Number(row.digest_hour_utc)
    })),
    exclusions: [
      "credentials, tokens, and secret values", "notification destinations",
      "member identities and owner assignments", "prompts, knowledge, and business payloads",
      "organization-specific encrypted DLP phrases", "process definitions (use process packages)",
      "legal holds and prior audit evidence"
    ]
  };
}

export async function previewConfigurationRestore(input: unknown) {
  const packageData = validatePackage(input);
  const checksum = await packageChecksum(packageData);
  const externalPolicies = packageData.notificationPolicies.filter((item) => item.channel !== "in_app");
  return {
    checksum,
    source: packageData.source,
    counts: sectionCounts(packageData),
    warnings: [
      "This restore changes configuration only; it never imports credentials, destinations, identities, processes, content, or audit history.",
      "Current lifecycle owner assignments and tenant legal holds are preserved.",
      ...(externalPolicies.length
        ? [`${externalPolicies.length} external notification policies will be restored disabled until their local destination and credential are reviewed.`]
        : [])
    ],
    package: packageData
  };
}

export async function applyConfigurationRestore(env: Env, tenantId: string, actorId: string, input: {
  package?: unknown; checksum?: string; reason?: string; confirmation?: string;
}) {
  if (input.confirmation !== "RESTORE CONFIGURATION") {
    throw new Error("Type RESTORE CONFIGURATION to apply this package");
  }
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10 || reason.length > 500) throw new Error("Restore reason must be 10–500 characters");
  const preview = await previewConfigurationRestore(input.package);
  if (!input.checksum || input.checksum !== preview.checksum) {
    throw new ConfigurationRestoreConflict("Package changed after preview; preview it again");
  }
  const data = preview.package;
  const now = new Date().toISOString();
  const restoreId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(`UPDATE tenant_settings SET organization_name=?, support_email=?, accent_color=?,
      default_model_profile=?, data_region=?, updated_at=? WHERE tenant_id=?`)
      .bind(data.organization.organizationName, data.organization.supportEmail, data.organization.accentColor,
        data.organization.defaultModelProfile, data.organization.dataRegion, now, tenantId)
  ];
  if (data.lifecycle) statements.push(env.DB.prepare(`UPDATE tenant_lifecycle_settings SET escalation_email=?,
    maintenance_day_utc=?, maintenance_hour_utc=?, recovery_review_due_at=?, updated_by=?, updated_at=?
    WHERE tenant_id=?`).bind(data.lifecycle.escalationEmail, data.lifecycle.maintenanceDayUtc,
    data.lifecycle.maintenanceHourUtc, data.lifecycle.recoveryReviewDueAt, actorId, now, tenantId));
  if (data.retention) statements.push(env.DB.prepare(`UPDATE tenant_retention_controls SET
    conversation_days=?, execution_days=?, approval_days=?, notification_days=?, help_request_days=?,
    api_log_days=?, updated_by=?, updated_at=? WHERE tenant_id=?`).bind(
    data.retention.conversationDays, data.retention.executionDays, data.retention.approvalDays,
    data.retention.notificationDays, data.retention.helpRequestDays, data.retention.apiLogDays,
    actorId, now, tenantId));
  for (const rule of data.dlpRules) statements.push(env.DB.prepare(`UPDATE dlp_rules SET action=?, direction=?,
    enabled=?, updated_by=?, updated_at=? WHERE tenant_id=? AND detector=?`).bind(
    rule.action, rule.direction, Number(rule.enabled), actorId, now, tenantId, rule.detector));
  for (const policy of data.notificationPolicies) statements.push(env.DB.prepare(`UPDATE notification_policies SET
    enabled=?, severity=?, acknowledgement_required=?, escalation_minutes=?, quiet_hours_enabled=?,
    quiet_start_hour_utc=?, quiet_end_hour_utc=?, critical_bypass=?, digest_mode=?, digest_hour_utc=?,
    updated_at=? WHERE tenant_id=? AND event_type=? AND channel=?`).bind(
    Number(policy.channel === "in_app" && policy.enabled), policy.severity,
    Number(policy.acknowledgementRequired), policy.escalationMinutes, Number(policy.quietHoursEnabled),
    policy.quietStartHourUtc, policy.quietEndHourUtc, Number(policy.criticalBypass),
    policy.digestMode, policy.digestHourUtc, now, tenantId, policy.eventType, policy.channel));
  statements.push(
    env.DB.prepare(`INSERT INTO configuration_restores
      (id, tenant_id, package_checksum, source_environment, source_tenant_id, status,
       section_counts_json, reason, applied_by, applied_at)
      VALUES (?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?)`).bind(
      restoreId, tenantId, preview.checksum, data.source.environment, data.source.tenantId,
      JSON.stringify(preview.counts), reason, actorId, now),
    env.DB.prepare(`INSERT INTO audit_events
      (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json, created_at)
      VALUES (?, ?, ?, 'configuration.restored', 'configuration_restore', ?, ?, ?)`).bind(
      crypto.randomUUID(), tenantId, actorId, restoreId, JSON.stringify({
        checksum: preview.checksum, counts: preview.counts,
        sourceEnvironment: data.source.environment, crossTenantSource: data.source.tenantId !== tenantId
      }), now)
  );
  await env.DB.batch(statements);
  return { id: restoreId, checksum: preview.checksum, counts: preview.counts, appliedAt: now };
}

export class ConfigurationRestoreConflict extends Error {}

function validatePackage(input: unknown): ConfigurationPackage {
  if (!input || typeof input !== "object") throw new Error("A configuration package is required");
  const value = input as Record<string, unknown>;
  if (value.schema !== "workrr-configuration/v1") throw new Error("Unsupported configuration package schema");
  const source = object(value.source, "source");
  const organization = object(value.organization, "organization");
  const lifecycle = value.lifecycle === null ? null : object(value.lifecycle, "lifecycle");
  const retention = value.retention === null ? null : object(value.retention, "retention");
  const rules = array(value.dlpRules, "DLP rules", 6);
  if (rules.length !== 6 || new Set(rules.map((item) => String(object(item, "DLP rule").detector))).size !== 6) {
    throw new Error("Configuration package must contain exactly the six unique DLP detectors");
  }
  const notificationPolicies = array(value.notificationPolicies, "notification policies", 80);
  const notificationKeys = notificationPolicies.map((item) => {
    const policy = object(item, "notification policy");
    return `${String(policy.eventType)}\u0000${String(policy.channel)}`;
  });
  if (new Set(notificationKeys).size !== notificationKeys.length) {
    throw new Error("Configuration package contains duplicate notification policies");
  }
  const result: ConfigurationPackage = {
    schema: "workrr-configuration/v1",
    exportedAt: text(value.exportedAt, "exportedAt", 10, 50),
    source: { environment: text(source.environment, "source environment", 1, 50),
      tenantId: text(source.tenantId, "source tenant", 1, 120) },
    organization: {
      organizationName: text(organization.organizationName, "organization name", 2, 120),
      supportEmail: email(organization.supportEmail, "support email"),
      accentColor: /^#[0-9a-f]{6}$/i.test(String(organization.accentColor))
        ? String(organization.accentColor) : invalid("A valid accent color is required"),
      defaultModelProfile: oneOf(organization.defaultModelProfile, models, "model profile"),
      dataRegion: text(organization.dataRegion, "data execution boundary", 2, 120)
    },
    lifecycle: lifecycle ? {
      escalationEmail: email(lifecycle.escalationEmail, "escalation email"),
      maintenanceDayUtc: integer(lifecycle.maintenanceDayUtc, "maintenance day", 0, 6),
      maintenanceHourUtc: integer(lifecycle.maintenanceHourUtc, "maintenance hour", 0, 23),
      recoveryReviewDueAt: lifecycle.recoveryReviewDueAt === null ? null
        : text(lifecycle.recoveryReviewDueAt, "recovery review", 10, 50)
    } : null,
    retention: retention ? {
      conversationDays: integer(retention.conversationDays, "conversation retention", 1, 2555),
      executionDays: integer(retention.executionDays, "execution retention", 1, 2555),
      approvalDays: integer(retention.approvalDays, "approval retention", 1, 2555),
      notificationDays: integer(retention.notificationDays, "notification retention", 1, 2555),
      helpRequestDays: integer(retention.helpRequestDays, "help retention", 1, 2555),
      apiLogDays: integer(retention.apiLogDays, "API log retention", 1, 2555)
    } : null,
    dlpRules: rules.map((item) => {
      const rule = object(item, "DLP rule");
      return { detector: oneOf(rule.detector, detectors, "DLP detector"),
        action: oneOf(rule.action, actions, "DLP action"),
        direction: oneOf(rule.direction, directions, "DLP direction"),
        enabled: boolean(rule.enabled, "DLP enabled") };
    }),
    notificationPolicies: notificationPolicies.map((item) => {
      const policy = object(item, "notification policy");
      return {
        eventType: text(policy.eventType, "notification event", 3, 120),
        channel: oneOf(policy.channel, channels, "notification channel"),
        enabled: boolean(policy.enabled, "notification enabled"),
        severity: oneOf(policy.severity, severities, "notification severity"),
        acknowledgementRequired: boolean(policy.acknowledgementRequired, "acknowledgement"),
        escalationMinutes: integer(policy.escalationMinutes, "escalation minutes", 0, 10080),
        quietHoursEnabled: boolean(policy.quietHoursEnabled, "quiet hours"),
        quietStartHourUtc: integer(policy.quietStartHourUtc, "quiet start", 0, 23),
        quietEndHourUtc: integer(policy.quietEndHourUtc, "quiet end", 0, 23),
        criticalBypass: boolean(policy.criticalBypass, "critical bypass"),
        digestMode: oneOf(policy.digestMode, digests, "digest mode"),
        digestHourUtc: integer(policy.digestHourUtc, "digest hour", 0, 23)
      };
    }),
    exclusions: Array.isArray(value.exclusions) ? value.exclusions.slice(0, 20).map(String) : []
  };
  if (!detectors.every((detector) => result.dlpRules.some((rule) => rule.detector === detector))) {
    throw new Error("Configuration package is missing a required DLP detector");
  }
  return result;
}

async function packageChecksum(value: ConfigurationPackage) {
  const canonical = JSON.stringify({ ...value, exportedAt: undefined, exclusions: undefined });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sectionCounts(value: ConfigurationPackage) {
  return { organization: 1, lifecycle: value.lifecycle ? 1 : 0, retention: value.retention ? 1 : 0,
    dlpRules: value.dlpRules.length, notificationPolicies: value.notificationPolicies.length };
}
function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Invalid ${label}`);
  return value;
}
function text(value: unknown, label: string, minimum: number, maximum: number) {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length < minimum || result.length > maximum) throw new Error(`Invalid ${label}`);
  return result;
}
function email(value: unknown, label: string) {
  const result = text(value, label, 3, 254).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}
function oneOf(value: unknown, allowed: string[], label: string) {
  const result = String(value);
  if (!allowed.includes(result)) throw new Error(`Invalid ${label}`);
  return result;
}
function integer(value: unknown, label: string, minimum: number, maximum: number) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new Error(`Invalid ${label}`);
  return result;
}
function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`Invalid ${label}`);
  return value;
}
function invalid(message: string): never { throw new Error(message); }
