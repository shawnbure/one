import type { Env } from "./types";

export async function assertTenantModelAllowed(env: Env, tenantId: string, modelId: string) {
  const row = await env.DB.prepare(`SELECT p.enabled FROM model_catalog m
    LEFT JOIN tenant_model_policies p ON p.tenant_id=? AND p.model_id=m.model_id
    WHERE m.model_id=? AND m.status='active'`).bind(tenantId, modelId)
    .first<{ enabled: number | null }>();
  if (!row || Number(row.enabled) !== 1) {
    throw new Error("This Cloudflare model is not approved by the organization model policy");
  }
}

export async function updateTenantModelPolicy(env: Env, tenantId: string, actorId: string,
  modelId: string, enabled: boolean) {
  const model = await env.DB.prepare("SELECT model_id FROM model_catalog WHERE model_id=? AND status='active'")
    .bind(modelId).first();
  if (!model) throw new Error("Cloudflare model was not found in the active catalog");
  if (!enabled) {
    const [active, pinnedActors] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) count FROM agent_blueprints b
        JOIN process_releases r ON r.id=b.active_release_id AND r.tenant_id=b.tenant_id
        WHERE b.tenant_id=? AND r.model_id=?`).bind(tenantId, modelId).first<{ count: number }>(),
      env.DB.prepare(`WITH latest_execution AS (
          SELECT instance_key, process_release_id, started_at,
            ROW_NUMBER() OVER (PARTITION BY instance_key ORDER BY started_at DESC, id DESC) rank
          FROM executions WHERE tenant_id=? AND instance_key IS NOT NULL
        ), latest_migration AS (
          SELECT instance_key, to_release_id, migrated_at,
            ROW_NUMBER() OVER (PARTITION BY instance_key ORDER BY migrated_at DESC, id DESC) rank
          FROM actor_release_migrations WHERE tenant_id=?
        ), effective_actor AS (
          SELECT CASE WHEN lm.migrated_at IS NOT NULL
              AND julianday(lm.migrated_at) >= julianday(le.started_at)
            THEN lm.to_release_id ELSE le.process_release_id END release_id
          FROM latest_execution le
          LEFT JOIN latest_migration lm ON lm.instance_key=le.instance_key AND lm.rank=1
          WHERE le.rank=1
        )
        SELECT COUNT(*) count FROM effective_actor ea
        JOIN process_releases r ON r.id=ea.release_id AND r.tenant_id=?
        WHERE r.model_id=?`).bind(tenantId, tenantId, tenantId, modelId).first<{ count: number }>()
    ]);
    const activeCount = Number(active?.count ?? 0);
    const actorCount = Number(pinnedActors?.count ?? 0);
    if (activeCount > 0 || actorCount > 0) {
      throw new Error(`Model is used by ${activeCount} active process release(s) and ${actorCount} known durable actor(s); migrate or retire them first`);
    }
    const remaining = await env.DB.prepare(`SELECT COUNT(*) count FROM tenant_model_policies
      WHERE tenant_id=? AND enabled=1 AND model_id<>?`).bind(tenantId, modelId).first<{ count: number }>();
    if (Number(remaining?.count ?? 0) < 1) throw new Error("At least one Cloudflare model must remain approved");
  }
  await env.DB.prepare(`INSERT INTO tenant_model_policies (tenant_id, model_id, enabled, updated_by)
    VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, model_id) DO UPDATE SET enabled=excluded.enabled,
      updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
    .bind(tenantId, modelId, Number(enabled), actorId).run();
  return { modelId, enabled };
}
