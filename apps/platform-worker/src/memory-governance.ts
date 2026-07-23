import { getAgentByName } from "agents";
import type { DurableActorFact, GovernedMemoryTurn, ProcessAgent } from "./agent";
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
  const facts = await agent.listDurableFacts(tenantId, reference.blueprintId, 50);
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
    durableFactPromotion: "human_approval_required",
    factPolicy: { maximumActiveFacts: 20, maximumFactCharacters: 500, maximumContextCharacters: 4_000 },
    currentReleaseId,
    currentVersion: releases?.current_version ?? null,
    activeReleaseId: releases?.active_release_id ?? null,
    activeVersion: releases?.active_version ?? null,
    migrationAvailable: Boolean(currentReleaseId && releases?.active_release_id &&
      currentReleaseId !== releases.active_release_id),
    turns,
    facts
  };
}

export async function proposeExecutionFact(env: Env, tenantId: string, actorId: string,
  executionId: string, raw: {
    category?: string; content?: string; sourceTurnId?: string; reason?: string; expiresAt?: string;
  }): Promise<DurableActorFact> {
  const input = validateFactProposal(raw);
  const reference = await actorReference(env, tenantId, executionId);
  const protectedContent = await applyDlp(env, tenantId, input.content, {
    direction: "input", stage: "memory_fact_proposal", executionId, blueprintId: reference.blueprintId
  });
  if (protectedContent.blocked) throw new DlpBlockedError(protectedContent.blockedDetectors);
  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, reference.instanceKey);
  await agent.bindTenant(tenantId, reference.blueprintId);
  return agent.proposeDurableFact(tenantId, reference.blueprintId, {
    ...input, content: protectedContent.safeText, actorId
  });
}

export async function governExecutionFact(env: Env, tenantId: string, actorId: string,
  executionId: string, factId: string, raw: {
    action?: string; expectedRevision?: number; content?: string; reason?: string; expiresAt?: string;
  }): Promise<DurableActorFact> {
  const input = validateFactChange(raw);
  const reference = await actorReference(env, tenantId, executionId);
  if (input.action === "correct") {
    const protectedContent = await applyDlp(env, tenantId, input.content!, {
      direction: "input", stage: "memory_fact_correction", executionId, blueprintId: reference.blueprintId
    });
    if (protectedContent.blocked) throw new DlpBlockedError(protectedContent.blockedDetectors);
    input.content = protectedContent.safeText;
  }
  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, reference.instanceKey);
  await agent.bindTenant(tenantId, reference.blueprintId);
  return agent.governDurableFact(tenantId, reference.blueprintId, factId, { ...input, actorId });
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

const factCategories = new Set(["preference", "customer_context", "process_context", "constraint"]);
const factActions = new Set(["approve", "correct", "retire"]);

export function validateFactProposal(raw: {
  category?: string; content?: string; sourceTurnId?: string; reason?: string; expiresAt?: string;
}) {
  if (!raw.category || !factCategories.has(raw.category)) throw new Error("A valid durable fact category is required");
  const content = raw.content?.trim() ?? "";
  if (!content || content.length > 500) throw new Error("Durable fact content must be 1 to 500 characters");
  const sourceTurnId = raw.sourceTurnId?.trim() ?? "";
  if (!sourceTurnId || sourceTurnId.length > 100) throw new Error("A source memory turn is required");
  const reason = boundedFactReason(raw.reason);
  const expiresAt = boundedFactExpiry(raw.expiresAt);
  return { category: raw.category as DurableActorFact["category"], content, sourceTurnId, reason, expiresAt };
}

export function validateFactChange(raw: {
  action?: string; expectedRevision?: number; content?: string; reason?: string; expiresAt?: string;
}) {
  if (!raw.action || !factActions.has(raw.action)) throw new Error("A valid durable fact action is required");
  if (!Number.isInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 1) {
    throw new Error("A valid expected durable fact revision is required");
  }
  const action = raw.action as "approve" | "correct" | "retire";
  const content = raw.content?.trim();
  if (action === "correct" && (!content || content.length > 500)) {
    throw new Error("Corrected durable fact content must be 1 to 500 characters");
  }
  return {
    action, expectedRevision: Number(raw.expectedRevision), content,
    reason: boundedFactReason(raw.reason),
    ...(raw.expiresAt ? { expiresAt: boundedFactExpiry(raw.expiresAt) } : {})
  };
}

function boundedFactReason(value?: string) {
  const reason = value?.trim() ?? "";
  if (reason.length < 5 || reason.length > 500) throw new Error("Durable fact reason must be 5 to 500 characters");
  return reason;
}

function boundedFactExpiry(value?: string) {
  const date = new Date(value ?? "");
  const now = Date.now();
  if (!Number.isFinite(date.getTime()) || date.getTime() < now + 60_000 ||
    date.getTime() > now + 365 * 86_400_000) {
    throw new Error("Durable fact expiry must be between one minute and one year from now");
  }
  return date.toISOString();
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
