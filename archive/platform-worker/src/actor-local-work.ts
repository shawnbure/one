import { getAgentByName } from "agents";
import type { ProcessAgent } from "./agent";
import { applyDlp, DlpBlockedError } from "./dlp";
import type { Env } from "./types";

const durableProfiles = new Set(["conversation", "consumer", "entity", "shared_shard", "temporary_durable"]);

type ActorExecution = {
  blueprint_id: string;
  execution_profile: string;
  instance_key: string | null;
};

async function resolveActor(env: Env, tenantId: string, executionId: string) {
  const execution = await env.DB.prepare(`SELECT blueprint_id, execution_profile, instance_key
    FROM executions WHERE tenant_id=? AND id=?`).bind(tenantId, executionId).first<ActorExecution>();
  if (!execution) throw new Error("Execution not found");
  if (!durableProfiles.has(execution.execution_profile) || !execution.instance_key) {
    throw new Error("Actor-local work is only available for durable execution profiles");
  }
  const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, execution.instance_key);
  await agent.bindTenant(tenantId, execution.blueprint_id);
  return { execution, agent };
}

function labelFrom(input: unknown) {
  const label = typeof input === "string" ? input.trim() : "";
  if (label.length < 3 || label.length > 160) throw new Error("Label must be between 3 and 160 characters");
  return label;
}

async function safeLabel(env: Env, tenantId: string, executionId: string, blueprintId: string, input: unknown) {
  const result = await applyDlp(env, tenantId, labelFrom(input), {
    direction: "input", stage: "actor_local_work", executionId, blueprintId
  });
  if (result.blocked) throw new DlpBlockedError(result.blockedDetectors);
  return result.modelText;
}

export async function listActorLocalWork(env: Env, tenantId: string, executionId: string) {
  const { execution, agent } = await resolveActor(env, tenantId, executionId);
  return { available: true, executionProfile: execution.execution_profile,
    ...(await agent.listLocalWork(tenantId, execution.blueprint_id)) };
}

export async function queueActorLocalWork(env: Env, tenantId: string, executionId: string, input: { label?: unknown }) {
  const { execution, agent } = await resolveActor(env, tenantId, executionId);
  const label = await safeLabel(env, tenantId, executionId, execution.blueprint_id, input.label);
  return agent.queueLocalTask(tenantId, execution.blueprint_id, executionId, label);
}

export async function scheduleActorLocalWork(env: Env, tenantId: string, executionId: string,
  input: { label?: unknown; dueAt?: unknown }) {
  const { execution, agent } = await resolveActor(env, tenantId, executionId);
  const label = await safeLabel(env, tenantId, executionId, execution.blueprint_id, input.label);
  if (typeof input.dueAt !== "string") throw new Error("A due time is required");
  const due = new Date(input.dueAt);
  const delta = due.getTime() - Date.now();
  if (!Number.isFinite(due.getTime()) || delta < 10_000 || delta > 30 * 24 * 60 * 60 * 1_000) {
    throw new Error("Due time must be between 10 seconds and 30 days from now");
  }
  return agent.scheduleLocalFollowUp(tenantId, execution.blueprint_id, executionId, label, due.toISOString());
}

export async function cancelActorLocalWork(env: Env, tenantId: string, executionId: string, scheduleId: string) {
  if (!scheduleId) throw new Error("Schedule ID is required");
  const { execution, agent } = await resolveActor(env, tenantId, executionId);
  return agent.cancelLocalSchedule(tenantId, execution.blueprint_id, scheduleId);
}
