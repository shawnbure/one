import type { Env } from "./types";

const actorReleaseCte = `WITH latest_execution AS (
    SELECT id execution_id, instance_key, process_release_id, started_at,
      ROW_NUMBER() OVER (PARTITION BY instance_key ORDER BY started_at DESC, id DESC) rank
    FROM executions WHERE tenant_id=? AND blueprint_id=? AND instance_key IS NOT NULL
  ), latest_migration AS (
    SELECT instance_key, to_release_id, migrated_at,
      ROW_NUMBER() OVER (PARTITION BY instance_key ORDER BY migrated_at DESC, id DESC) rank
    FROM actor_release_migrations WHERE tenant_id=? AND blueprint_id=?
  ), actor_release AS (
    SELECT le.execution_id, le.instance_key, le.started_at last_active_at,
      CASE WHEN lm.migrated_at IS NOT NULL
        AND julianday(lm.migrated_at) >= julianday(le.started_at)
        THEN lm.to_release_id ELSE le.process_release_id END effective_release_id
    FROM latest_execution le
    LEFT JOIN latest_migration lm ON lm.instance_key=le.instance_key AND lm.rank=1
    WHERE le.rank=1
  )`;

export async function listActorReleaseRollouts(env: Env, tenantId: string, blueprintId: string) {
  const { results } = await env.DB.prepare(`SELECT r.*, target.version target_version,
      requester.display_name requested_by_name
    FROM actor_release_rollouts r
    JOIN process_releases target ON target.id=r.target_release_id AND target.tenant_id=r.tenant_id
    LEFT JOIN tenant_members requester ON requester.id=r.requested_by AND requester.tenant_id=r.tenant_id
    WHERE r.tenant_id=? AND r.blueprint_id=? ORDER BY r.created_at DESC LIMIT 20`)
    .bind(tenantId, blueprintId).all();
  return results;
}

export async function createActorReleaseRollout(env: Env, tenantId: string, actorId: string,
  blueprintId: string, raw: { percentage?: number; targetReleaseId?: string; reason?: string }) {
  const percentage = Number(raw.percentage);
  if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
    throw new Error("Rollout percentage must be a whole number from 1 to 100");
  }
  const reason = raw.reason?.trim() ?? "";
  if (reason.length < 10 || reason.length > 500) throw new Error("Rollout reason must be 10 to 500 characters");
  const [process, inProgress] = await Promise.all([
    env.DB.prepare(`SELECT b.active_release_id, b.execution_profile, r.status release_status,
        r.evaluation_status, r.version
      FROM agent_blueprints b
      LEFT JOIN process_releases r ON r.id=b.active_release_id AND r.tenant_id=b.tenant_id
      WHERE b.id=? AND b.tenant_id=?`).bind(blueprintId, tenantId).first<{
        active_release_id: string | null; execution_profile: string; release_status: string | null;
        evaluation_status: string | null; version: number | null;
      }>(),
    env.DB.prepare(`SELECT id FROM actor_release_rollouts WHERE tenant_id=? AND blueprint_id=?
      AND status IN ('queued','running') LIMIT 1`).bind(tenantId, blueprintId).first<{ id: string }>()
  ]);
  if (!process) throw new Error("Process was not found");
  if (["instant", "workflow"].includes(process.execution_profile)) {
    throw new Error("Release rollout applies only to durable Agent profiles");
  }
  if (!process.active_release_id || raw.targetReleaseId !== process.active_release_id) {
    throw new Error("Confirm the current active release before starting a rollout");
  }
  if (process.release_status !== "published" || process.evaluation_status !== "passing") {
    throw new Error("Target release must be published with passing evaluation evidence");
  }
  if (inProgress) throw new Error("A release rollout is already active for this process");

  const count = await env.DB.prepare(`${actorReleaseCte}
    SELECT COUNT(*) actor_count FROM actor_release
    WHERE effective_release_id IS NOT NULL AND effective_release_id != ?`)
    .bind(tenantId, blueprintId, tenantId, blueprintId, process.active_release_id)
    .first<{ actor_count: number }>();
  const eligibleActors = Number(count?.actor_count ?? 0);
  if (!eligibleActors) throw new Error("No pinned actors are eligible for this rollout");
  const selectedActorCount = Math.ceil(eligibleActors * percentage / 100);
  if (selectedActorCount > 200) {
    throw new Error("This cohort exceeds the 200-actor rollout limit; choose a smaller percentage");
  }
  const selected = await env.DB.prepare(`${actorReleaseCte}
    SELECT execution_id, instance_key, effective_release_id
    FROM actor_release WHERE effective_release_id IS NOT NULL AND effective_release_id != ?
    ORDER BY julianday(last_active_at) DESC, instance_key ASC LIMIT ?`)
    .bind(tenantId, blueprintId, tenantId, blueprintId, process.active_release_id, selectedActorCount)
    .all<{ execution_id: string; instance_key: string; effective_release_id: string }>();
  if (selected.results.length !== selectedActorCount) throw new Error("Actor cohort changed; reload before rollout");

  const rolloutId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(`INSERT INTO actor_release_rollouts
      (id, tenant_id, blueprint_id, target_release_id, percentage, selected_actor_count, reason,
       requested_by, workflow_instance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(rolloutId, tenantId, blueprintId, process.active_release_id, percentage, selectedActorCount,
        reason, actorId, rolloutId),
    ...selected.results.map((item) => env.DB.prepare(`INSERT INTO actor_release_rollout_items
      (id, rollout_id, tenant_id, blueprint_id, instance_key, source_execution_id, from_release_id, to_release_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), rolloutId, tenantId, blueprintId,
      item.instance_key, item.execution_id, item.effective_release_id, process.active_release_id!))
  ];
  for (let offset = 0; offset < statements.length; offset += 50) {
    await env.DB.batch(statements.slice(offset, offset + 50));
  }
  try {
    await env.ACTOR_RELEASE_ROLLOUT.create({
      id: rolloutId as `${string}-${string}-${string}-${string}-${string}`,
      params: { tenantId, actorId, rolloutId }
    });
  } catch (error) {
    await env.DB.prepare(`UPDATE actor_release_rollouts SET status='failed', error=?,
      completed_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 500), rolloutId, tenantId).run();
    throw error;
  }
  return {
    id: rolloutId, status: "queued" as const, targetReleaseId: process.active_release_id,
    targetVersion: process.version, percentage, eligibleActors, selectedActorCount
  };
}
