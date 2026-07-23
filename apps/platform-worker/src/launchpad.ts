import { getAgentByName } from "agents";
import type { ExecutionRequest } from "@workrr/contracts";
import type { ProcessAgent } from "./agent";
import { executeRequest } from "./execution";
import type { Env } from "./types";

type ThreadRow = {
  id: string;
  blueprint_id: string;
  process_name: string;
  title: string;
  status: "active" | "archived";
  last_execution_id: string | null;
  created_at: string;
  updated_at: string;
};

type OwnedThreadRow = ThreadRow & {
  execution_profile: string;
  process_status: string;
  operating_mode: string | null;
  active_release_id: string | null;
};

export async function listLaunchpadThreads(
  env: Env,
  tenantId: string,
  actorId: string,
  blueprintId?: string,
) {
  const filter = blueprintId ? " AND t.blueprint_id=?" : "";
  const args = blueprintId ? [tenantId, actorId, blueprintId] : [tenantId, actorId];
  const rows = await env.DB.prepare(`SELECT t.id, t.blueprint_id, b.name process_name, t.title, t.status,
      t.last_execution_id, t.created_at, t.updated_at
    FROM process_threads t
    JOIN agent_blueprints b ON b.id=t.blueprint_id AND b.tenant_id=t.tenant_id
    WHERE t.tenant_id=? AND t.created_by=?${filter}
    ORDER BY CASE t.status WHEN 'active' THEN 0 ELSE 1 END, t.updated_at DESC
    LIMIT 100`).bind(...args).all<ThreadRow>();
  return rows.results;
}

export async function createLaunchpadThread(
  env: Env,
  tenantId: string,
  actorId: string,
  blueprintId: string,
  rawTitle?: string,
) {
  const process = await launchpadProcess(env, tenantId, blueprintId);
  if (process.execution_profile !== "conversation") {
    throw new Error("Only conversation agents use reopenable threads");
  }
  assertRunnable(process);
  const title = normalizeTitle(rawTitle);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO process_threads
    (id, tenant_id, blueprint_id, created_by, title)
    VALUES (?, ?, ?, ?, ?)`).bind(id, tenantId, blueprintId, actorId, title).run();
  return { id, blueprintId, processName: process.name, title, status: "active" as const };
}

export async function getLaunchpadConversation(
  env: Env,
  tenantId: string,
  actorId: string,
  threadId: string,
) {
  const thread = await ownedThread(env, tenantId, actorId, threadId);
  if (!thread.last_execution_id) return { thread, messages: [] };
  const agent = await getAgentByName<Env, ProcessAgent>(
    env.PROCESS_AGENT,
    `${thread.blueprint_id}:thread:${thread.id}`,
  );
  await agent.bindTenant(tenantId, thread.blueprint_id);
  return { thread, messages: await agent.getConversation(60) };
}

export async function executeLaunchpadThread(
  env: Env,
  tenantId: string,
  actorId: string,
  threadId: string,
  input: string,
) {
  const thread = await ownedThread(env, tenantId, actorId, threadId);
  if (thread.status !== "active") throw new Error("Archived conversations are read-only");
  assertRunnable({
    status: thread.process_status,
    operating_mode: thread.operating_mode,
    active_release_id: thread.active_release_id,
  });
  const result = await executeRequest(env, tenantId, {
    blueprintId: thread.blueprint_id,
    threadId,
    input: requiredInput(input),
    metadata: { source: "launchpad", actorId },
  });
  await env.DB.prepare(`UPDATE process_threads SET last_execution_id=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND created_by=?`)
    .bind(result.executionId, threadId, tenantId, actorId).run();
  return result;
}

export async function executeLaunchpadProcess(
  env: Env,
  tenantId: string,
  actorId: string,
  blueprintId: string,
  input: string,
) {
  const process = await launchpadProcess(env, tenantId, blueprintId);
  assertRunnable(process);
  if (process.execution_profile === "conversation") {
    throw new Error("Create or reopen a conversation before running this process");
  }
  if (["entity", "shared_shard"].includes(process.execution_profile)) {
    throw new Error("This process requires a configured business identity and cannot start from the launchpad");
  }
  const request: ExecutionRequest = {
    blueprintId,
    input: requiredInput(input),
    metadata: { source: "launchpad", actorId },
  };
  if (process.execution_profile === "consumer") request.consumerId = actorId;
  if (process.execution_profile === "temporary_durable") request.idempotencyKey = crypto.randomUUID();
  return executeRequest(env, tenantId, request);
}

export async function governConsumerExecutionRequest(
  env: Env,
  tenantId: string,
  actorId: string,
  request: ExecutionRequest,
): Promise<ExecutionRequest> {
  const process = await launchpadProcess(env, tenantId, request.blueprintId);
  if (process.execution_profile === "conversation") {
    if (!request.threadId) throw new Error("Create or reopen a conversation before running this process");
    await ownedThread(env, tenantId, actorId, request.threadId);
    return request;
  }
  if (process.execution_profile === "consumer") {
    return { ...request, consumerId: actorId };
  }
  if (["entity", "shared_shard"].includes(process.execution_profile)) {
    throw new Error("This process requires a configured business identity");
  }
  return request;
}

export async function setLaunchpadThreadArchived(
  env: Env,
  tenantId: string,
  actorId: string,
  threadId: string,
  archived: boolean,
) {
  const thread = await ownedThread(env, tenantId, actorId, threadId);
  if (!archived) {
    assertRunnable({
      status: thread.process_status,
      operating_mode: thread.operating_mode,
      active_release_id: thread.active_release_id,
    });
  }
  const status = archived ? "archived" : "active";
  await env.DB.prepare(`UPDATE process_threads SET status=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND created_by=?`).bind(status, threadId, tenantId, actorId).run();
  return { id: threadId, status };
}

async function ownedThread(env: Env, tenantId: string, actorId: string, threadId: string) {
  const thread = await env.DB.prepare(`SELECT t.id, t.blueprint_id, b.name process_name, t.title, t.status,
      t.last_execution_id, t.created_at, t.updated_at, b.execution_profile,
      b.status process_status, b.operating_mode, b.active_release_id
    FROM process_threads t
    JOIN agent_blueprints b ON b.id=t.blueprint_id AND b.tenant_id=t.tenant_id
    WHERE t.id=? AND t.tenant_id=? AND t.created_by=?`)
    .bind(threadId, tenantId, actorId).first<OwnedThreadRow>();
  if (!thread) throw new Error("Conversation was not found");
  return thread;
}

async function launchpadProcess(env: Env, tenantId: string, blueprintId: string) {
  const process = await env.DB.prepare(`SELECT id, name, execution_profile, status, operating_mode,
      active_release_id FROM agent_blueprints WHERE id=? AND tenant_id=?`)
    .bind(blueprintId, tenantId).first<{
      id: string;
      name: string;
      execution_profile: string;
      status: string;
      operating_mode: string | null;
      active_release_id: string | null;
    }>();
  if (!process) throw new Error("Process was not found");
  return process;
}

function assertRunnable(process: {
  status: string;
  operating_mode: string | null;
  active_release_id: string | null;
}) {
  if (!process.active_release_id) throw new Error("Process does not have a published release");
  if (process.status !== "active") throw new Error("Process is not active");
  if (["paused", "drain", "emergency_stop"].includes(process.operating_mode ?? "active")) {
    throw new Error(`Process is ${process.operating_mode}`);
  }
}

function normalizeTitle(value?: string) {
  const title = value?.trim() || "New conversation";
  if (title.length > 80) throw new Error("Conversation title must be 80 characters or fewer");
  return title;
}

function requiredInput(value: string) {
  const input = value?.trim();
  if (!input || input.length > 50_000) throw new Error("Input must be 1 to 50,000 characters");
  return input;
}
