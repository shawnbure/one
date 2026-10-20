import { getAgentByName } from "agents";
import type { ActorOperationalSnapshot, ProcessAgent } from "./agent";
import type { Env } from "./types";

const durableProfiles = new Set(["conversation", "consumer", "entity", "shared_shard", "temporary_durable"]);

type ActorHealthReference = {
  blueprint_id: string;
  execution_profile: string;
  instance_key: string | null;
  process_release_id: string | null;
  active_release_id: string | null;
  active_version: number | null;
  pinned_version: number | null;
};

export interface ActorOperationalHealth extends ActorOperationalSnapshot {
  executionProfile: string;
  storage: "durable_object_sqlite";
  compute: "ephemeral_worker_request";
  durability: "durable_actor";
  health: "healthy" | "attention" | "critical" | "awaiting_evidence";
  releaseState: "current" | "update_available" | "unattributed";
  activeProcessReleaseId: string | null;
  activeProcessVersion: number | null;
  pinnedProcessVersion: number | null;
  attention: string[];
}

export async function inspectExecutionActorHealth(
  env: Env,
  tenantId: string,
  executionId: string,
): Promise<ActorOperationalHealth> {
  const reference = await env.DB.prepare(`SELECT e.blueprint_id, e.execution_profile, e.instance_key,
      e.process_release_id, b.active_release_id, active.version active_version, pinned.version pinned_version
    FROM executions e
    JOIN agent_blueprints b ON b.id=e.blueprint_id AND b.tenant_id=e.tenant_id
    LEFT JOIN process_releases active ON active.id=b.active_release_id AND active.tenant_id=b.tenant_id
    LEFT JOIN process_releases pinned ON pinned.id=e.process_release_id AND pinned.tenant_id=e.tenant_id
    WHERE e.id=? AND e.tenant_id=?`)
    .bind(executionId, tenantId).first<ActorHealthReference>();
  if (!reference) throw new Error("Execution was not found");
  if (!durableProfiles.has(reference.execution_profile) || !reference.instance_key) {
    throw new Error("Actor health is only available for durable execution profiles");
  }
  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, reference.instance_key);
  const snapshot = await agent.inspectOperationalHealth(tenantId, reference.blueprint_id);
  const actorRelease = snapshot.pinnedProcessReleaseId === reference.process_release_id
    ? { version: reference.pinned_version }
    : snapshot.pinnedProcessReleaseId
      ? await env.DB.prepare(`SELECT version FROM process_releases WHERE id=? AND tenant_id=?`)
        .bind(snapshot.pinnedProcessReleaseId, tenantId).first<{ version: number }>()
      : null;
  return classifyActorHealth({ ...reference, pinned_version: actorRelease?.version ?? null }, snapshot);
}

export function classifyActorHealth(
  reference: Pick<ActorHealthReference, "execution_profile" | "active_release_id" | "active_version" |
    "pinned_version">,
  snapshot: ActorOperationalSnapshot,
): ActorOperationalHealth {
  const attention: string[] = [];
  const releaseState = !snapshot.pinnedProcessReleaseId ? "unattributed" :
    snapshot.pinnedProcessReleaseId === reference.active_release_id ? "current" : "update_available";
  if (!snapshot.bound) attention.push("Actor identity is not bound to its tenant and process.");
  if (!snapshot.installedPromptBundles) attention.push("No immutable prompt bundle is installed.");
  if (releaseState === "unattributed") attention.push("The actor has no attributable process release.");
  if (releaseState === "update_available") attention.push("A newer active process release is available.");
  if (snapshot.facts.expiredActive) {
    attention.push(`${snapshot.facts.expiredActive} expired durable fact(s) remain marked active but are excluded from context.`);
  }
  if (snapshot.localWork.failed) attention.push(`${snapshot.localWork.failed} actor-local task(s) failed.`);
  const critical = !snapshot.bound || !snapshot.installedPromptBundles || snapshot.localWork.failed > 0;
  const health = critical ? "critical" : attention.length ? "attention" :
    snapshot.lastActiveAt ? "healthy" : "awaiting_evidence";
  return {
    ...snapshot,
    executionProfile: reference.execution_profile,
    storage: "durable_object_sqlite",
    compute: "ephemeral_worker_request",
    durability: "durable_actor",
    health,
    releaseState,
    activeProcessReleaseId: reference.active_release_id,
    activeProcessVersion: reference.active_version,
    pinnedProcessVersion: reference.pinned_version,
    attention,
  };
}
