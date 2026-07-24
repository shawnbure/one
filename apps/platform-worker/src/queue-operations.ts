import type { QueueJob } from "@workrr/contracts";
import type { Env } from "./types";
import { assertMatchingFingerprint, executionFingerprint, IdempotencyConflictError } from "./execution-idempotency";

export type QueueSource = "api" | "webhook" | "email" | "schedule" | "replay";

export async function enqueueProcessJob(
  env: Env,
  job: QueueJob,
  source: QueueSource,
  replayedFrom?: string,
) {
  const tenantId = job.tenantId ?? "demo";
  let deliveryJob = job;
  let executionId = job.executionId;
  const idempotencyFingerprint = job.idempotencyKey
    ? await executionFingerprint(env, tenantId, job)
    : null;
  const reservation = await env.DB.prepare(`INSERT OR IGNORE INTO executions
    (id, tenant_id, blueprint_id, instance_key, execution_profile, status, input_preview, idempotency_key,
     started_at, process_release_id, idempotency_fingerprint)
    SELECT ?, b.tenant_id, b.id, NULL, b.execution_profile, 'queued', ?, ?, CURRENT_TIMESTAMP,
      b.active_release_id, ?
    FROM agent_blueprints b WHERE b.id=? AND b.tenant_id=?`)
    .bind(job.executionId, job.input.slice(0, 500), job.idempotencyKey ?? null, idempotencyFingerprint,
      job.blueprintId, tenantId).run();
  let recoveringHandoff = false;
  if (reservation.meta.changes !== 1) {
    const existing = await (job.idempotencyKey
      ? env.DB.prepare(`SELECT id, blueprint_id, idempotency_fingerprint, status, error
          FROM executions WHERE tenant_id=? AND idempotency_key=?`)
        .bind(tenantId, job.idempotencyKey)
      : env.DB.prepare(`SELECT id, blueprint_id, idempotency_fingerprint, status, error
          FROM executions WHERE tenant_id=? AND id=?`)
        .bind(tenantId, job.executionId)
    ).first<{ id: string; blueprint_id: string; idempotency_fingerprint: string | null;
      status: string; error: string | null }>();
    if (!existing) throw new Error("Process not found or execution reservation could not be resolved");
    if (existing.blueprint_id !== job.blueprintId) {
      throw new IdempotencyConflictError("Idempotency key is already assigned to a different process");
    }
    assertMatchingFingerprint(existing.idempotency_fingerprint, idempotencyFingerprint ?? "");
    recoveringHandoff = existing.status === "failed" &&
      existing.error?.startsWith("Queue handoff failed before processing:") === true;
    if (existing.id !== job.executionId) {
      if (!recoveringHandoff) {
        return { queueJobId: null, executionId: existing.id, duplicate: true };
      }
      executionId = existing.id;
      deliveryJob = { ...job, executionId };
    }
  }
  const queueJobId = crypto.randomUUID();
  const claimStatement = env.DB.prepare(`INSERT INTO process_queue_jobs
    (id, tenant_id, execution_id, blueprint_id, source, status, replayed_from)
    VALUES (?, ?, ?, ?, ?, 'queued', ?)
    ON CONFLICT(tenant_id, execution_id) DO UPDATE SET status='queued', last_error=NULL,
      completed_at=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE process_queue_jobs.status='enqueue_failed'`)
    .bind(queueJobId, tenantId, executionId, job.blueprintId, source, replayedFrom ?? null);
  if (recoveringHandoff) {
    const rearmStatement = env.DB.prepare(`UPDATE executions SET status='queued', error=NULL, completed_at=NULL
      WHERE id=? AND tenant_id=? AND status='failed'
        AND error LIKE 'Queue handoff failed before processing:%'`)
      .bind(executionId, tenantId);
    const [claim, rearmed] = await env.DB.batch([claimStatement, rearmStatement]);
    if (claim?.meta.changes !== 1 || rearmed?.meta.changes !== 1) {
      throw new Error("Queue handoff recovery lost its execution claim");
    }
  } else {
    const claim = await claimStatement.run();
    if (claim.meta.changes !== 1) throw new Error("Execution already has a Queue delivery record");
  }
  try {
    await env.PROCESS_QUEUE.send(deliveryJob, { contentType: "json" });
  } catch (error) {
    const message = errorMessage(error);
    await env.DB.batch([
      env.DB.prepare(`UPDATE process_queue_jobs SET status = 'enqueue_failed', last_error = ?,
        completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE execution_id = ? AND tenant_id = ?`)
        .bind(message, executionId, tenantId),
      env.DB.prepare(`UPDATE executions SET status='failed', error=?, completed_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=? AND status='queued'`)
        .bind(`Queue handoff failed before processing: ${message}`.slice(0, 1000), executionId, tenantId)
    ]);
    throw error;
  }
  return { queueJobId, executionId, duplicate: false };
}

export async function markQueueProcessing(env: Env, job: QueueJob, attempts: number) {
  const tenantId = job.tenantId ?? "demo";
  await env.DB.prepare(`INSERT INTO process_queue_jobs
    (id, tenant_id, execution_id, blueprint_id, source, status, attempt_count, started_at)
    VALUES (?, ?, ?, ?, 'api', 'processing', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_id, execution_id) DO UPDATE SET status = 'processing',
      attempt_count = excluded.attempt_count, started_at = COALESCE(process_queue_jobs.started_at, CURRENT_TIMESTAMP),
      last_error = NULL, updated_at = CURRENT_TIMESTAMP`)
    .bind(crypto.randomUUID(), tenantId, job.executionId, job.blueprintId, attempts).run();
}

export async function markQueueFinished(env: Env, job: QueueJob, status: "completed" | "deferred") {
  await env.DB.prepare(`UPDATE process_queue_jobs SET status = ?, completed_at = CURRENT_TIMESTAMP,
    last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND execution_id = ?`)
    .bind(status, job.tenantId ?? "demo", job.executionId).run();
}

export async function markQueueFailure(env: Env, job: QueueJob, attempts: number, error: unknown, terminal: boolean) {
  await env.DB.prepare(`UPDATE process_queue_jobs SET status = ?, attempt_count = ?, last_error = ?,
    completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND execution_id = ?`)
    .bind(terminal ? "dead_lettered" : "retrying", attempts, errorMessage(error),
      terminal ? new Date().toISOString() : null, job.tenantId ?? "demo", job.executionId).run();
}

export async function getQueueOperations(env: Env, tenantId: string) {
  const [summary, jobs] = await Promise.all([
    env.DB.prepare(`SELECT status, COUNT(*) count FROM process_queue_jobs
      WHERE tenant_id = ? GROUP BY status`).bind(tenantId).all(),
    env.DB.prepare(`SELECT q.id, q.execution_id, q.blueprint_id, b.name process_name, q.source, q.status,
      q.attempt_count, q.replayed_from, q.last_error, q.enqueued_at, q.started_at, q.completed_at, q.updated_at,
      CASE WHEN e.id IS NULL THEN 0 ELSE 1 END replayable,
      rt.id recovery_task_id, rt.status recovery_status, rt.due_at recovery_due_at,
      rt.assigned_to recovery_assigned_to, rm.display_name recovery_owner_name
      FROM process_queue_jobs q
      LEFT JOIN agent_blueprints b ON b.id = q.blueprint_id AND b.tenant_id = q.tenant_id
      LEFT JOIN executions e ON e.id = q.execution_id AND e.tenant_id = q.tenant_id
      LEFT JOIN execution_recovery_tasks rt ON rt.execution_id=q.execution_id AND rt.tenant_id=q.tenant_id
      LEFT JOIN tenant_members rm ON rm.id=rt.assigned_to AND rm.tenant_id=rt.tenant_id
      WHERE q.tenant_id = ? ORDER BY q.updated_at DESC LIMIT 100`).bind(tenantId).all(),
  ]);
  return { summary: summary.results, jobs: jobs.results };
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
