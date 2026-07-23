import { getAgentByName } from "agents";
import type { GovernedMemoryTurn, ProcessAgent } from "./agent";
import { applyDlp, DlpBlockedError } from "./dlp";
import type { Env } from "./types";

const durableProfiles = new Set(["conversation", "consumer", "entity", "shared_shard", "temporary_durable"]);
const actions = new Set(["correct", "quarantine", "restore", "delete"]);

interface ActorReference {
  blueprintId: string;
  instanceKey: string;
  executionProfile: string;
  processReleaseId: string | null;
}

export async function listExecutionMemory(env: Env, tenantId: string, executionId: string) {
  const reference = await actorReference(env, tenantId, executionId);
  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, reference.instanceKey);
  await agent.bindTenant(tenantId, reference.blueprintId);
  const turns = await agent.listGovernedMemory(tenantId, reference.blueprintId, 50);
  const currentReleaseId = await agent.pinnedReleaseId() ?? reference.processReleaseId;
  const releases = await env.DB.prepare(`SELECT b.active_release_id, active.version active_version,
      current.version current_version
    FROM agent_blueprints b
    LEFT JOIN process_releases active ON active.id=b.active_release_id AND active.tenant_id=b.tenant_id
    LEFT JOIN process_releases current ON current.id=? AND current.tenant_id=b.tenant_id
    WHERE b.id=? AND b.tenant_id=?`).bind(currentReleaseId, reference.blueprintId, tenantId).first<{
      active_release_id: string | null; active_version: number | null; current_version: number | null;
    }>();
  return {
    executionProfile: reference.executionProfile,
    storage: "agent_sqlite",
    contextPolicy: { maximumTurns: 20, maximumCharacters: 24_000, maximumCharactersPerTurn: 8_000 },
    durableFactPromotion: "disabled",
    currentReleaseId,
    currentVersion: releases?.current_version ?? null,
    activeReleaseId: releases?.active_release_id ?? null,
    activeVersion: releases?.active_version ?? null,
    migrationAvailable: Boolean(currentReleaseId && releases?.active_release_id &&
      currentReleaseId !== releases.active_release_id),
    turns
  };
}

export async function governExecutionMemory(env: Env, tenantId: string, actorId: string,
  executionId: string, turnId: string, raw: {
    action?: string; expectedRevision?: number; content?: string; reason?: string;
  }): Promise<GovernedMemoryTurn> {
  const input = validateMemoryChange(raw);
  const reference = await actorReference(env, tenantId, executionId);
  let content = input.content;
  if (input.action === "correct") {
    const protectedContent = await applyDlp(env, tenantId, content!, {
      direction: "input", stage: "memory_correction", executionId, blueprintId: reference.blueprintId
    });
    if (protectedContent.blocked) throw new DlpBlockedError(protectedContent.blockedDetectors);
    content = protectedContent.safeText;
  }
  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, reference.instanceKey);
  await agent.bindTenant(tenantId, reference.blueprintId);
  return agent.governMemory(tenantId, reference.blueprintId, turnId, {
    action: input.action, expectedRevision: input.expectedRevision, content,
    reason: input.reason, actorId
  });
}

export function validateMemoryChange(raw: {
  action?: string; expectedRevision?: number; content?: string; reason?: string;
}) {
  if (!raw.action || !actions.has(raw.action)) throw new Error("A valid memory action is required");
  if (!Number.isInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 1) {
    throw new Error("A valid expected memory revision is required");
  }
  const reason = raw.reason?.trim() ?? "";
  if (reason.length < 5 || reason.length > 500) throw new Error("Memory change reason must be 5 to 500 characters");
  const action = raw.action as "correct" | "quarantine" | "restore" | "delete";
  const content = raw.content?.trim();
  if (action === "correct" && (!content || content.length > 8_000)) {
    throw new Error("Corrected memory content must be 1 to 8,000 characters");
  }
  return { action, expectedRevision: Number(raw.expectedRevision), content, reason };
}

async function actorReference(env: Env, tenantId: string, executionId: string): Promise<ActorReference> {
  const execution = await env.DB.prepare(`SELECT blueprint_id, execution_profile, instance_key, process_release_id
    FROM executions WHERE id=? AND tenant_id=?`).bind(executionId, tenantId).first<{
      blueprint_id: string; execution_profile: string; instance_key: string | null; process_release_id: string | null;
    }>();
  if (!execution) throw new Error("Execution was not found");
  if (!durableProfiles.has(execution.execution_profile) || !execution.instance_key) {
    throw new Error("This execution does not have actor-local conversational memory");
  }
  return {
    blueprintId: execution.blueprint_id,
    instanceKey: execution.instance_key,
    executionProfile: execution.execution_profile,
    processReleaseId: execution.process_release_id
  };
}
