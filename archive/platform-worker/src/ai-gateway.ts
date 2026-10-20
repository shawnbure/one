import type { Env } from "./types";

export interface AiGatewaySetting {
  gatewayId: string;
  enabled: boolean;
  collectLogs: boolean;
  evidenceReference: string | null;
  updatedBy: string;
  updatedAt: string;
}

export async function getAiGatewaySetting(env: Env, tenantId: string): Promise<AiGatewaySetting> {
  const row = await env.DB.prepare(`SELECT gateway_id, enabled, collect_logs, evidence_reference,
    updated_by, updated_at FROM tenant_ai_gateway_settings WHERE tenant_id=?`)
    .bind(tenantId).first<{
      gateway_id: string; enabled: number; collect_logs: number; evidence_reference: string | null;
      updated_by: string; updated_at: string;
    }>();
  return {
    gatewayId: row?.gateway_id ?? "default",
    enabled: Boolean(row?.enabled),
    collectLogs: Boolean(row?.collect_logs),
    evidenceReference: row?.evidence_reference ?? null,
    updatedBy: row?.updated_by ?? "system",
    updatedAt: row?.updated_at ?? ""
  };
}

export async function updateAiGatewaySetting(env: Env, tenantId: string, actorId: string, input: {
  gatewayId?: string;
  enabled?: boolean;
  collectLogs?: boolean;
  evidenceReference?: string;
}) {
  const current = await getAiGatewaySetting(env, tenantId);
  const gatewayId = String(input.gatewayId ?? current.gatewayId).trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(gatewayId)) {
    throw new Error("Gateway ID must use 1–64 lowercase letters, numbers, or hyphens");
  }
  const enabled = input.enabled ?? current.enabled;
  const collectLogs = input.collectLogs ?? current.collectLogs;
  const evidenceReference = String(input.evidenceReference ?? current.evidenceReference ?? "").trim();
  if (enabled && evidenceReference.length < 10) {
    throw new Error("Enabling AI Gateway requires privacy and billing review evidence");
  }
  if (!enabled && current.enabled) {
    const active = await env.DB.prepare(`SELECT COUNT(*) count FROM agent_blueprints b
      JOIN process_releases r ON r.id=b.active_release_id AND r.tenant_id=b.tenant_id
      WHERE b.tenant_id=? AND r.model_id NOT LIKE '@cf/%'`).bind(tenantId).first<{ count: number }>();
    if (Number(active?.count ?? 0) > 0) {
      throw new Error("AI Gateway is used by an active process release; migrate or retire it first");
    }
  }
  await env.DB.prepare(`INSERT INTO tenant_ai_gateway_settings
    (tenant_id, gateway_id, enabled, collect_logs, evidence_reference, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET gateway_id=excluded.gateway_id,
      enabled=excluded.enabled, collect_logs=excluded.collect_logs,
      evidence_reference=excluded.evidence_reference, updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP`)
    .bind(tenantId, gatewayId, Number(enabled), Number(collectLogs),
      evidenceReference || null, actorId).run();
  return getAiGatewaySetting(env, tenantId);
}

export async function requireAiGatewaySetting(env: Env, tenantId: string) {
  const setting = await getAiGatewaySetting(env, tenantId);
  if (!setting.enabled) throw new Error("The organization AI Gateway handoff is not enabled");
  return setting;
}
