import type { Env } from "./types";

export interface OnboardingManifest {
  organizationName: string;
  supportEmail: string;
  accentColor: string;
  defaultModelProfile: "fast" | "balanced" | "reasoning";
  dataRegion?: string;
}

export async function getOnboarding(env: Env, tenantId: string) {
  const [settings, members, processes, connections, policies] = await Promise.all([
    env.DB.prepare("SELECT * FROM tenant_settings WHERE tenant_id = ?").bind(tenantId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM tenant_members WHERE tenant_id = ? AND status = 'active'").bind(tenantId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM agent_blueprints WHERE tenant_id = ?").bind(tenantId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM connections WHERE tenant_id = ?").bind(tenantId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM retention_policies WHERE tenant_id = ?").bind(tenantId).first<{ count: number }>()
  ]);
  return {
    settings,
    checklist: [
      { id: "organization", label: "Organization profile", ready: Boolean(settings) },
      { id: "members", label: "Administrator membership", ready: Number(members?.count) > 0 },
      { id: "processes", label: "First AI process", ready: Number(processes?.count) > 0 },
      { id: "connections", label: "Connection boundary", ready: Number(connections?.count) > 0 },
      { id: "retention", label: "Retention controls", ready: Number(policies?.count) > 0 }
    ]
  };
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
        input.defaultModelProfile, input.dataRegion || "Cloudflare global network", now, actorId, now)
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
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), settings: onboarding.settings, processes: processes.results, members: members.results, retention: retention.results, secrets: "excluded" };
}
