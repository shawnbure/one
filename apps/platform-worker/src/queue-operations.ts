import type { QueueJob } from "@workrr/contracts";
import type { Env } from "./types";

export type QueueSource = "api" | "webhook" | "schedule" | "replay";

export async function enqueueProcessJob(
  env: Env,
  job: QueueJob,
  source: QueueSource,
  replayedFrom?: string,
) {
  const tenantId = job.tenantId ?? "demo";
  const queueJobId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO process_queue_jobs
    (id, tenant_id, execution_id, blueprint_id, source, status, replayed_from)
    VALUES (?, ?, ?, ?, ?, 'queued', ?)`)
    .bind(queueJobId, tenantId, job.executionId, job.blueprintId, source, replayedFrom ?? null).run();
  try {
    await env.PROCESS_QUEUE.send(job, { contentType: "json" });
  } catch (error) {
    await env.DB.prepare(`UPDATE process_queue_jobs SET status = 'enqueue_failed', last_error = ?,
      completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?`)
      .bind(errorMessage(error), queueJobId, tenantId).run();
    throw error;
  }
  return queueJobId;
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
      q.attempt_count, q.replayed_from, q.last_error, q.enqueued_at, q.started_at, q.completed_at, q.updated_at
      , CASE WHEN e.id IS NULL THEN 0 ELSE 1 END replayable
      FROM process_queue_jobs q
      LEFT JOIN agent_blueprints b ON b.id = q.blueprint_id AND b.tenant_id = q.tenant_id
      LEFT JOIN executions e ON e.id = q.execution_id AND e.tenant_id = q.tenant_id
      WHERE q.tenant_id = ? ORDER BY q.updated_at DESC LIMIT 100`).bind(tenantId).all(),
  ]);
  return { summary: summary.results, jobs: jobs.results };
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
