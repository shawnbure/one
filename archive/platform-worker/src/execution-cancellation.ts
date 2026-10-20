import type { QueueJob } from "@workrr/contracts";
import { applyDlp, DlpBlockedError } from "./dlp";
import type { Env } from "./types";

interface CancellableExecution {
  id: string;
  execution_profile: string;
  status: string;
  queue_status: string | null;
}

export class ExecutionCancellationConflict extends Error {}

export async function cancelQueuedExecution(
  env: Env,
  tenantId: string,
  actorId: string,
  executionId: string,
  raw: { reason?: unknown },
) {
  const submittedReason = cancellationReason(raw.reason);
  const protectedReason = await applyDlp(env, tenantId, submittedReason, {
    direction: "input", stage: "execution_cancellation", executionId,
  });
  if (protectedReason.blocked) throw new DlpBlockedError(protectedReason.blockedDetectors);
  const reason = protectedReason.safeText;
  const execution = await env.DB.prepare(`SELECT e.id, e.execution_profile, e.status,
      q.status queue_status
    FROM executions e
    LEFT JOIN process_queue_jobs q ON q.execution_id=e.id AND q.tenant_id=e.tenant_id
    WHERE e.id=? AND e.tenant_id=?`)
    .bind(executionId, tenantId).first<CancellableExecution>();
  if (!execution) throw new Error("Execution not found");
  if (execution.status !== "queued") {
    throw new ExecutionCancellationConflict("Only queued work can be cancelled");
  }

  if (execution.execution_profile === "workflow") {
    const instance = await env.PROCESS_WORKFLOW.get(executionId);
    const state = await instance.status();
    if (!["queued", "running", "waiting", "paused", "waitingForPause"].includes(state.status)) {
      throw new ExecutionCancellationConflict(`Workflow is already ${state.status}`);
    }
    await instance.terminate({ rollback: true });
  } else if (!["queued", "retrying"].includes(execution.queue_status ?? "")) {
    throw new ExecutionCancellationConflict("Queue delivery has already started");
  }

  const now = new Date().toISOString();
  if (execution.execution_profile !== "workflow") {
    const latch = await env.DB.prepare(`UPDATE process_queue_jobs SET cancellation_requested_at=?,
      cancellation_requested_by=?, cancellation_reason=?, updated_at=?
      WHERE execution_id=? AND tenant_id=? AND status IN ('queued','retrying')
        AND cancellation_requested_at IS NULL`)
      .bind(now, actorId, reason, now, executionId, tenantId).run();
    if (latch.meta.changes !== 1) {
      throw new ExecutionCancellationConflict("Queue delivery started while cancellation was being requested");
    }
  }
  const cancelled = await env.DB.prepare(`UPDATE executions SET status='cancelled', cancellation_reason=?,
    cancelled_at=?, cancelled_by=?, completed_at=?, error=NULL
    WHERE id=? AND tenant_id=? AND status='queued'`)
    .bind(reason, now, actorId, now, executionId, tenantId).run();
  if (cancelled.meta.changes !== 1) {
    throw new ExecutionCancellationConflict("Execution started while cancellation was being requested");
  }
  return {
    id: executionId,
    status: "cancelled" as const,
    executionProfile: execution.execution_profile,
    reason,
    cancelledAt: now,
  };
}

export async function acknowledgeCancelledQueueJob(env: Env, job: QueueJob) {
  const tenantId = job.tenantId ?? "demo";
  const execution = await env.DB.prepare(`SELECT status FROM executions
    WHERE id=? AND tenant_id=?`).bind(job.executionId, tenantId).first<{ status: string }>();
  if (execution?.status !== "cancelled") return false;
  await env.DB.batch([
    env.DB.prepare(`UPDATE process_queue_jobs SET status='completed',
      completion_disposition='cancelled', completed_at=CURRENT_TIMESTAMP,
      last_error=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE execution_id=? AND tenant_id=? AND cancellation_requested_at IS NOT NULL`)
      .bind(job.executionId, tenantId),
    env.DB.prepare(`UPDATE schedule_dispatches SET status='completed',
      completed_at=CURRENT_TIMESTAMP, error='Cancelled by an authorized operator before processing'
      WHERE execution_id=? AND tenant_id=? AND status='queued'`)
      .bind(job.executionId, tenantId),
  ]);
  return true;
}

function cancellationReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < 10 || reason.length > 500) {
    throw new Error("Cancellation reason must be 10 to 500 characters");
  }
  return reason;
}
