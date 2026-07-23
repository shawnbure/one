import type { ToolActionJob, ToolPolicy } from "@workrr/contracts";
import { invokeApprovedBoundAdapter } from "./tool-adapters";
import { emitNotification } from "./notifications";
import type { Env } from "./types";

interface ProposedInvocationRow {
  id: string;
  execution_id: string;
  tool_name: string;
  handler_key: string | null;
  access_mode: string;
}

interface DispatchRow {
  id: string;
  tenant_id: string;
  approval_id: string;
  execution_id: string;
  invocation_id: string;
  status: string;
  input_json: string;
  idempotency_key: string;
  tool_id: string;
  tool_version: number;
  handler_key: string | null;
  tool_policy_json: string;
}

export async function decideApproval(env: Env, tenantId: string, actorId: string, approvalId: string,
  decision: "approved" | "rejected", note?: string) {
  const decidedAt = new Date().toISOString();
  if (decision === "approved") {
    const state = await env.DB.prepare("SELECT review_state FROM approvals WHERE id=? AND tenant_id=?")
      .bind(approvalId, tenantId).first<{ review_state: string }>();
    if (state?.review_state === "information_requested") {
      throw new Error("Requested information must be answered before this item can be approved");
    }
  }
  const result = await env.DB.prepare(`UPDATE approvals SET status=?, decided_at=?, decided_by=?, decision_note=?
    WHERE id=? AND tenant_id=? AND status='pending'
      AND (?='rejected' OR review_state!='information_requested')`)
    .bind(decision, decidedAt, actorId, note?.slice(0, 2000) ?? null, approvalId, tenantId, decision).run();
  if (result.meta.changes !== 1) return { updated: false, dispatched: 0, enqueueFailed: 0 };
  const approval = await env.DB.prepare("SELECT execution_id FROM approvals WHERE id=? AND tenant_id=?")
    .bind(approvalId, tenantId).first<{ execution_id: string }>();
  if (!approval) throw new Error("Approval decision could not be reloaded");
  const { results: proposed } = await env.DB.prepare(`SELECT id, execution_id, tool_name, handler_key, access_mode
    FROM tool_invocations WHERE tenant_id=? AND execution_id=? AND status='proposed'`)
    .bind(tenantId, approval.execution_id).all<ProposedInvocationRow>();
  if (decision === "rejected") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE tool_invocations SET status='denied', error='Rejected by authorized reviewer',
        completed_at=? WHERE tenant_id=? AND execution_id=? AND status='proposed'`)
        .bind(decidedAt, tenantId, approval.execution_id),
      env.DB.prepare(`UPDATE executions SET status='blocked', autonomy_disposition='rejected', completed_at=?
        WHERE tenant_id=? AND approval_id=? AND status='waiting_approval'`)
        .bind(decidedAt, tenantId, approvalId),
      audit(env, tenantId, actorId, `approval.${decision}`, "approval", approvalId,
        { decision, note, proposedInvocations: proposed.map((item) => item.id) })
    ]);
    return { updated: true, dispatched: 0, enqueueFailed: 0 };
  }
  const actionable = proposed.filter((item) =>
    item.access_mode === "write" && item.handler_key === "microsoft.calendar.event.create");
  if (!actionable.length) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE executions SET status='completed', autonomy_disposition='approved', completed_at=COALESCE(completed_at, ?)
        WHERE tenant_id=? AND approval_id=? AND status='waiting_approval'`)
        .bind(decidedAt, tenantId, approvalId),
      audit(env, tenantId, actorId, `approval.${decision}`, "approval", approvalId, { decision, note, dispatched: 0 })
    ]);
    return { updated: true, dispatched: 0, enqueueFailed: 0 };
  }
  const dispatches = actionable.map((item) => ({
    id: `tool-action-${item.id}`,
    invocationId: item.id
  }));
  await env.DB.batch([
    ...dispatches.map((dispatch) => env.DB.prepare(`INSERT OR IGNORE INTO tool_action_dispatches
      (id, tenant_id, approval_id, execution_id, invocation_id, status, approved_by)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(dispatch.id, tenantId, approvalId, approval.execution_id, dispatch.invocationId, actorId)),
    env.DB.prepare(`UPDATE executions SET status='queued', autonomy_disposition='approved_action_queued',
      completed_at=NULL WHERE tenant_id=? AND approval_id=? AND status='waiting_approval'`)
      .bind(tenantId, approvalId),
    audit(env, tenantId, actorId, `approval.${decision}`, "approval", approvalId,
      { decision, note, dispatches: dispatches.map((item) => item.id) })
  ]);
  let enqueueFailed = 0;
  for (const dispatch of dispatches) {
    try {
      await env.PROCESS_QUEUE.send({
        kind: "tool_action", tenantId, dispatchId: dispatch.id
      } satisfies ToolActionJob, { contentType: "json" });
      await env.DB.prepare(`UPDATE tool_action_dispatches SET status='queued', enqueued_at=?,
        last_error=NULL, updated_at=? WHERE id=? AND tenant_id=? AND status IN ('pending','enqueue_failed')`)
        .bind(decidedAt, decidedAt, dispatch.id, tenantId).run();
    } catch (error) {
      enqueueFailed += 1;
      await env.DB.prepare(`UPDATE tool_action_dispatches SET status='enqueue_failed', last_error=?,
        updated_at=? WHERE id=? AND tenant_id=?`)
        .bind(message(error), decidedAt, dispatch.id, tenantId).run();
    }
  }
  return { updated: true, dispatched: dispatches.length, enqueueFailed };
}

export async function retryToolAction(env: Env, tenantId: string, actorId: string, dispatchId: string) {
  const now = new Date().toISOString();
  const dispatch = await env.DB.prepare(`SELECT d.execution_id, d.invocation_id, d.status,
    a.status approval_status FROM tool_action_dispatches d
    JOIN approvals a ON a.id=d.approval_id AND a.tenant_id=d.tenant_id
    WHERE d.id=? AND d.tenant_id=?`).bind(dispatchId, tenantId).first<{
      execution_id: string; invocation_id: string; status: string; approval_status: string;
    }>();
  if (!dispatch) throw new Error("Approved tool action was not found");
  if (dispatch.approval_status !== "approved") throw new Error("The action no longer has an approved decision");
  if (dispatch.status !== "failed") throw new Error("Only a terminally failed action can be retried manually");
  const claimed = await env.DB.prepare(`UPDATE tool_action_dispatches SET status='pending', last_error=NULL,
    completed_at=NULL, updated_at=? WHERE id=? AND tenant_id=? AND status='failed'`)
    .bind(now, dispatchId, tenantId).run();
  if (claimed.meta.changes !== 1) return { updated: false, status: dispatch.status };
  await env.DB.batch([
    env.DB.prepare(`UPDATE tool_invocations SET status='proposed', error=NULL, completed_at=NULL
      WHERE id=? AND tenant_id=?`).bind(dispatch.invocation_id, tenantId),
    env.DB.prepare(`UPDATE executions SET status='queued', error=NULL, completed_at=NULL,
      autonomy_disposition='approved_action_queued' WHERE id=? AND tenant_id=?`)
      .bind(dispatch.execution_id, tenantId),
    audit(env, tenantId, actorId, "tool_action.retry_requested", "tool_action", dispatchId, {
      executionId: dispatch.execution_id, invocationId: dispatch.invocation_id
    })
  ]);
  try {
    await env.PROCESS_QUEUE.send({ kind: "tool_action", tenantId, dispatchId } satisfies ToolActionJob,
      { contentType: "json" });
    await env.DB.prepare(`UPDATE tool_action_dispatches SET status='queued', enqueued_at=?,
      updated_at=? WHERE id=? AND tenant_id=? AND status='pending'`)
      .bind(now, now, dispatchId, tenantId).run();
    return { updated: true, status: "queued" };
  } catch (error) {
    await env.DB.prepare(`UPDATE tool_action_dispatches SET status='enqueue_failed', last_error=?,
      updated_at=? WHERE id=? AND tenant_id=? AND status='pending'`)
      .bind(message(error), now, dispatchId, tenantId).run();
    return { updated: true, status: "enqueue_failed" };
  }
}

export async function cancelToolAction(env: Env, tenantId: string, actorId: string, dispatchId: string,
  note?: string) {
  const now = new Date().toISOString();
  const dispatch = await env.DB.prepare(`SELECT execution_id, invocation_id, status
    FROM tool_action_dispatches WHERE id=? AND tenant_id=?`).bind(dispatchId, tenantId).first<{
      execution_id: string; invocation_id: string; status: string;
    }>();
  if (!dispatch) throw new Error("Approved tool action was not found");
  const result = await env.DB.prepare(`UPDATE tool_action_dispatches SET status='rejected',
    last_error=?, completed_at=?, updated_at=? WHERE id=? AND tenant_id=?
    AND status IN ('pending','queued','retrying','enqueue_failed')`)
    .bind(note?.trim().slice(0, 500) || "Cancelled by an authorized operator", now, now, dispatchId, tenantId).run();
  if (result.meta.changes !== 1) {
    throw new Error(`An action in ${dispatch.status.replaceAll("_", " ")} state cannot be cancelled`);
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE tool_invocations SET status='denied', error=?, completed_at=?
      WHERE id=? AND tenant_id=? AND status='proposed'`)
      .bind("Approved action delivery cancelled by an authorized operator", now, dispatch.invocation_id, tenantId),
    env.DB.prepare(`UPDATE executions SET status='blocked', error=NULL, completed_at=?,
      autonomy_disposition='approved_action_cancelled' WHERE id=? AND tenant_id=?`)
      .bind(now, dispatch.execution_id, tenantId),
    audit(env, tenantId, actorId, "tool_action.cancelled", "tool_action", dispatchId, {
      executionId: dispatch.execution_id, invocationId: dispatch.invocation_id, note: note?.trim().slice(0, 500) || null
    })
  ]);
  return { updated: true, status: "rejected" };
}

export async function processToolAction(env: Env, job: ToolActionJob) {
  const dispatch = await loadDispatch(env, job.tenantId, job.dispatchId);
  if (!dispatch) throw new Error("Approved tool action dispatch was not found");
  if (["completed", "failed", "rejected"].includes(dispatch.status)) {
    return { duplicate: true, providerResourceId: dispatch.status === "completed" ? null : undefined };
  }
  const claimed = await env.DB.prepare(`UPDATE tool_action_dispatches SET status='processing',
    attempt_count=attempt_count+1, started_at=COALESCE(started_at, CURRENT_TIMESTAMP),
    updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status IN ('queued','retrying','enqueue_failed')`)
    .bind(job.dispatchId, job.tenantId).run();
  if (claimed.meta.changes !== 1) throw new Error(`Approved tool action is ${dispatch.status}`);
  const current = await loadDispatch(env, job.tenantId, job.dispatchId);
  if (!current) throw new Error("Approved tool action disappeared after claim");
  const approval = await env.DB.prepare("SELECT status FROM approvals WHERE id=? AND tenant_id=?")
    .bind(current.approval_id, job.tenantId).first<{ status: string }>();
  if (approval?.status !== "approved") throw new Error("Tool action no longer has an approved decision");
  const policy = exactPolicy(current);
  const result = await invokeApprovedBoundAdapter(env, job.tenantId, current.execution_id, policy,
    parseJson(current.input_json), current.idempotency_key);
  const completedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE tool_action_dispatches SET status='completed', provider_resource_id=?,
      completed_at=?, last_error=NULL, updated_at=? WHERE id=? AND tenant_id=?`)
      .bind(result.providerResourceId, completedAt, completedAt, current.id, job.tenantId),
    env.DB.prepare(`UPDATE tool_invocations SET status='completed', output_json=?, error=NULL,
      completed_at=? WHERE id=? AND tenant_id=?`)
      .bind(JSON.stringify(result.evidenceOutput).slice(0, 8000), completedAt, current.invocation_id, job.tenantId),
    audit(env, job.tenantId, "system", "tool_action.completed", "tool_action", current.id, {
      invocationId: current.invocation_id, providerResourceId: result.providerResourceId
    })
  ]);
  await completeExecutionIfSettled(env, job.tenantId, current.execution_id);
  return { duplicate: false, providerResourceId: result.providerResourceId };
}

export async function markToolActionFailure(env: Env, job: ToolActionJob, error: unknown, terminal: boolean) {
  const status = terminal ? "failed" : "retrying";
  const now = new Date().toISOString();
  const dispatch = await env.DB.prepare("SELECT execution_id, invocation_id FROM tool_action_dispatches WHERE id=? AND tenant_id=?")
    .bind(job.dispatchId, job.tenantId).first<{ execution_id: string; invocation_id: string }>();
  if (!dispatch) return;
  const statements = [
    env.DB.prepare(`UPDATE tool_action_dispatches SET status=?, last_error=?, completed_at=?,
      updated_at=? WHERE id=? AND tenant_id=?`)
      .bind(status, message(error), terminal ? now : null, now, job.dispatchId, job.tenantId)
  ];
  if (terminal) {
    statements.push(
      env.DB.prepare(`UPDATE tool_invocations SET status='failed', error=?, completed_at=?
        WHERE id=? AND tenant_id=?`).bind(message(error), now, dispatch.invocation_id, job.tenantId),
      env.DB.prepare(`UPDATE executions SET status='failed', error=?, completed_at=? WHERE id=? AND tenant_id=?`)
        .bind(message(error), now, dispatch.execution_id, job.tenantId)
    );
  }
  await env.DB.batch(statements);
  await audit(env, job.tenantId, "system", terminal ? "tool_action.failed" : "tool_action.retry_scheduled",
    "tool_action", job.dispatchId, { executionId: dispatch.execution_id, error: message(error), terminal }).run();
  if (terminal) await emitNotification(env, job.tenantId, {
    eventType: "queue.retry_exhausted", title: "Approved tool action exhausted retries",
    detail: message(error), targetType: "execution", targetId: dispatch.execution_id
  });
}

export async function enqueueRecoverableToolActions(env: Env) {
  const { results } = await env.DB.prepare(`SELECT id, tenant_id FROM tool_action_dispatches
    WHERE status IN ('pending','enqueue_failed') AND datetime(updated_at) <= datetime('now','-1 minute')
    ORDER BY updated_at LIMIT 50`).all<{ id: string; tenant_id: string }>();
  let queued = 0;
  for (const row of results) {
    try {
      await env.PROCESS_QUEUE.send({
        kind: "tool_action", tenantId: row.tenant_id, dispatchId: row.id
      } satisfies ToolActionJob, { contentType: "json" });
      const result = await env.DB.prepare(`UPDATE tool_action_dispatches SET status='queued',
        enqueued_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=? AND status IN ('pending','enqueue_failed')`)
        .bind(row.id, row.tenant_id).run();
      queued += result.meta.changes;
    } catch (error) {
      await env.DB.prepare(`UPDATE tool_action_dispatches SET status='enqueue_failed',
        last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
        .bind(message(error), row.id, row.tenant_id).run();
    }
  }
  return { queued };
}

async function loadDispatch(env: Env, tenantId: string, dispatchId: string) {
  return env.DB.prepare(`SELECT d.*, i.input_json, i.idempotency_key, i.tool_id, i.tool_version,
    i.handler_key, e.tool_policy_json FROM tool_action_dispatches d
    JOIN tool_invocations i ON i.id=d.invocation_id AND i.tenant_id=d.tenant_id
    JOIN executions e ON e.id=d.execution_id AND e.tenant_id=d.tenant_id
    WHERE d.id=? AND d.tenant_id=?`).bind(dispatchId, tenantId).first<DispatchRow>();
}

function exactPolicy(dispatch: DispatchRow): ToolPolicy {
  const policies = parseJson(dispatch.tool_policy_json);
  if (!Array.isArray(policies)) throw new Error("Execution tool policy evidence is invalid");
  const policy = policies.find((item) => item && typeof item === "object" &&
    String((item as Record<string, unknown>).id) === dispatch.tool_id &&
    Number((item as Record<string, unknown>).version) === dispatch.tool_version) as ToolPolicy | undefined;
  if (!policy || policy.handlerKey !== dispatch.handler_key) throw new Error("Approved tool policy no longer matches its release evidence");
  return { ...policy, connectionReady: true };
}

async function completeExecutionIfSettled(env: Env, tenantId: string, executionId: string) {
  const outstanding = await env.DB.prepare(`SELECT COUNT(*) count FROM tool_action_dispatches
    WHERE tenant_id=? AND execution_id=? AND status!='completed'`)
    .bind(tenantId, executionId).first<{ count: number }>();
  if (Number(outstanding?.count ?? 0) === 0) {
    await env.DB.prepare(`UPDATE executions SET status='completed', autonomy_disposition='approved_action_completed',
      completed_at=CURRENT_TIMESTAMP, error=NULL WHERE id=? AND tenant_id=?`).bind(executionId, tenantId).run();
  }
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new Error("Approved tool action evidence is not valid JSON"); }
}

function audit(env: Env, tenantId: string, actorId: string, eventType: string, targetType: string,
  targetId: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, targetType, targetId, JSON.stringify(detail));
}

function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
