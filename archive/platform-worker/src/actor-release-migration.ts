import { getAgentByName } from "agents";
import type { ProcessAgent } from "./agent";
import { getPromptBundle } from "./repository";
import type { Env } from "./types";

const durableProfiles = new Set(["conversation", "consumer", "entity", "shared_shard", "temporary_durable"]);

export async function migrateExecutionActorRelease(env: Env, tenantId: string, actorId: string,
  executionId: string, raw: { targetReleaseId?: string; confirmFromReleaseId?: string; reason?: string }) {
  const reason = raw.reason?.trim() ?? "";
  if (reason.length < 10 || reason.length > 500) throw new Error("Migration reason must be 10 to 500 characters");
  const reference = await env.DB.prepare(`SELECT e.blueprint_id, e.execution_profile, e.instance_key,
      e.process_release_id, source.prompt_release_id source_prompt_release_id,
      b.active_release_id, target.prompt_release_id, target.version,
      target.status target_status, target.evaluation_status
    FROM executions e
    JOIN agent_blueprints b ON b.id=e.blueprint_id AND b.tenant_id=e.tenant_id
    LEFT JOIN process_releases source ON source.id=e.process_release_id AND source.tenant_id=e.tenant_id
    LEFT JOIN process_releases target ON target.id=b.active_release_id AND target.tenant_id=b.tenant_id
    WHERE e.id=? AND e.tenant_id=?`).bind(executionId, tenantId).first<{
      blueprint_id: string; execution_profile: string; instance_key: string | null;
      process_release_id: string | null; source_prompt_release_id: string | null;
      active_release_id: string | null; prompt_release_id: string | null;
      version: number | null; target_status: string | null; evaluation_status: string | null;
    }>();
  if (!reference) throw new Error("Execution was not found");
  if (!durableProfiles.has(reference.execution_profile) || !reference.instance_key) {
    throw new Error("This execution does not reference a durable Agent actor");
  }
  if (!reference.active_release_id || !reference.prompt_release_id) throw new Error("Process has no active release");
  if (raw.targetReleaseId !== reference.active_release_id) {
    throw new Error("Confirm the current active release ID before migrating");
  }
  if (reference.target_status !== "published" || reference.evaluation_status !== "passing") {
    throw new Error("Target release must be published with passing evaluation evidence");
  }
  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, reference.instance_key);
  await agent.bindTenant(tenantId, reference.blueprint_id);
  let fromReleaseId = await agent.pinnedReleaseId();
  if (!fromReleaseId && reference.process_release_id) {
    const legacyPromptReleaseId = await agent.pinnedPromptReleaseId();
    if (!legacyPromptReleaseId || legacyPromptReleaseId !== reference.source_prompt_release_id) {
      throw new Error("Legacy actor prompt release cannot be attributed to the source execution");
    }
    await agent.adoptProcessRelease(reference.process_release_id, legacyPromptReleaseId);
    fromReleaseId = reference.process_release_id;
  }
  if (!fromReleaseId) throw new Error("Actor has no attributable installed release");
  if (raw.confirmFromReleaseId !== fromReleaseId) throw new Error("Actor release changed; reload before migrating");
  if (fromReleaseId === reference.active_release_id) {
    return { changed: false, fromReleaseId, toReleaseId: reference.active_release_id,
      targetVersion: reference.version, migratedAt: null };
  }
  const prompt = await getPromptBundle(env, reference.prompt_release_id);
  if (!prompt) throw new Error("Target prompt release was not found");
  await agent.migratePromptBundle(prompt, tenantId, fromReleaseId, reference.active_release_id);
  const id = `actor-migration-${crypto.randomUUID()}`;
  const migratedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO actor_release_migrations
    (id, tenant_id, blueprint_id, instance_key, source_execution_id, from_release_id, to_release_id,
     reason, migrated_by, migrated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, tenantId, reference.blueprint_id, reference.instance_key, executionId, fromReleaseId,
      reference.active_release_id, reason, actorId, migratedAt).run();
  return { id, changed: true, fromReleaseId, toReleaseId: reference.active_release_id,
    targetVersion: reference.version, migratedAt };
}
