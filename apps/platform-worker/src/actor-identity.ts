import type { Env } from "./types";

const durableProfiles = new Set([
  "conversation", "consumer", "entity", "shared_shard", "temporary_durable",
]);

export interface ActorIdentityUpgradeInput {
  reason?: unknown;
  confirmation?: unknown;
}

export async function upgradeActorIdentity(
  env: Env,
  tenantId: string,
  blueprintId: string,
  input: ActorIdentityUpgradeInput,
) {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 10 || reason.length > 500) {
    throw new Error("A 10 to 500 character operational reason is required");
  }
  if (input.confirmation !== "UPGRADE ACTOR IDENTITY") {
    throw new Error("Confirm UPGRADE ACTOR IDENTITY");
  }
  const process = await env.DB.prepare(`SELECT id, execution_profile, actor_identity_version, operating_mode
    FROM agent_blueprints WHERE id=? AND tenant_id=?`).bind(blueprintId, tenantId).first<{
      id: string;
      execution_profile: string;
      actor_identity_version: number;
      operating_mode: string;
    }>();
  if (!process) throw new Error("Process not found");
  if (!durableProfiles.has(process.execution_profile)) {
    throw new Error("Instant and Workflow processes do not have a durable actor identity");
  }
  if (Number(process.actor_identity_version) === 2) {
    return { changed: false, version: 2 as const, reason: "Already tenant-scoped" };
  }
  if (process.operating_mode !== "paused") {
    throw new Error("Pause the process before changing its actor identity");
  }
  const evidence = await env.DB.prepare(`SELECT COUNT(*) count FROM executions
    WHERE tenant_id=? AND blueprint_id=? AND instance_key IS NOT NULL`)
    .bind(tenantId, blueprintId).first<{ count: number }>();
  if (Number(evidence?.count ?? 0) > 0) {
    throw new Error("Existing durable actor evidence prevents an in-place identity upgrade");
  }
  const updated = await env.DB.prepare(`UPDATE agent_blueprints
    SET actor_identity_version=2, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND actor_identity_version=1 AND operating_mode='paused'
      AND NOT EXISTS (
        SELECT 1 FROM executions
        WHERE tenant_id=? AND blueprint_id=? AND instance_key IS NOT NULL
      )`).bind(blueprintId, tenantId, tenantId, blueprintId).run();
  if (updated.meta.changes !== 1) {
    throw new Error("Actor identity state changed; reload before upgrading");
  }
  return { changed: true, version: 2 as const, reason };
}
