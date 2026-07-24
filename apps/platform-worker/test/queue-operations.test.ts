import { describe, expect, it } from "vitest";
import { enqueueProcessJob, getQueueOperations, markQueueFailure, markQueueFinished, markQueueProcessing } from "../src/queue-operations";

function environment(sendError?: Error, existingExecutionId?: string,
  existingState: { status: string; error: string | null } = { status: "completed", error: null }) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const queries: string[] = [];
  const sent: unknown[] = [];
  const DB = {
    prepare(sql: string) {
      queries.push(sql);
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          return sql.includes("FROM executions WHERE") && existingExecutionId
            ? { id: existingExecutionId, blueprint_id: "process-1", idempotency_fingerprint: null,
              ...existingState }
            : null;
        },
        async run() {
          writes.push({ sql, bindings });
          return { meta: { changes: existingExecutionId &&
            sql.includes("INSERT OR IGNORE INTO executions") ? 0 : 1 } };
        },
        async all() { return { results: [] }; },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  const PROCESS_QUEUE = { async send(job: unknown) {
    if (sendError) throw sendError;
    sent.push(job);
  } };
  return { env: { DB, PROCESS_QUEUE, OAUTH_TOKEN_ENCRYPTION_KEY:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } as never, writes, queries, sent };
}

const job = { blueprintId: "process-1", input: "safe input", executionId: "execution-1",
  attempt: 0, tenantId: "tenant-1" };

describe("Queue lifecycle evidence", () => {
  it("persists tenant-scoped evidence before Queue handoff", async () => {
    const { env, writes, sent } = environment();
    await enqueueProcessJob(env, job, "webhook");
    expect(sent).toEqual([job]);
    expect(writes[0]?.sql).toContain("INSERT OR IGNORE INTO executions");
    const queueEvidence = writes.find((write) => write.sql.includes("INSERT INTO process_queue_jobs"));
    expect(queueEvidence?.bindings).toEqual(expect.arrayContaining(["tenant-1", "execution-1", "process-1", "webhook"]));
  });

  it("preserves an enqueue failure for operator diagnosis", async () => {
    const { env, writes } = environment(new Error("Queue unavailable"));
    await expect(enqueueProcessJob(env, job, "api")).rejects.toThrow("Queue unavailable");
    expect(writes.some((write) => write.sql.includes("status = 'enqueue_failed'") &&
      write.bindings.includes("Queue unavailable"))).toBe(true);
    expect(writes.some((write) => write.sql.includes("UPDATE executions SET status='failed'") &&
      write.bindings.includes("Queue handoff failed before processing: Queue unavailable") &&
      write.bindings.includes("tenant-1"))).toBe(true);
  });

  it("does not enqueue a second delivery when another execution owns the idempotency key", async () => {
    const keyedJob = { ...job, idempotencyKey: "customer-job-42" };
    const { env, sent } = environment(undefined, "execution-original");
    const result = await enqueueProcessJob(env, keyedJob, "api");
    expect(result).toEqual({
      queueJobId: null, executionId: "execution-original", duplicate: true
    });
    expect(sent).toHaveLength(0);
  });

  it("rearms only an execution that failed before Queue processing", async () => {
    const { env, writes, sent } = environment(undefined, "execution-1", {
      status: "failed", error: "Queue handoff failed before processing: Queue unavailable"
    });
    await enqueueProcessJob(env, job, "email");
    expect(sent).toEqual([job]);
    expect(writes.some((write) => write.sql.includes("SET status='queued', error=NULL") &&
      write.bindings.includes("execution-1") && write.bindings.includes("tenant-1"))).toBe(true);
  });

  it("requeues the canonical execution when an API retry supplies a fresh execution id", async () => {
    const retry = { ...job, executionId: "execution-retry", idempotencyKey: "customer-job-42" };
    const { env, writes, sent } = environment(undefined, "execution-original", {
      status: "failed", error: "Queue handoff failed before processing: Queue unavailable"
    });
    const result = await enqueueProcessJob(env, retry, "api");
    expect(result).toMatchObject({ executionId: "execution-original", duplicate: false });
    expect(sent).toEqual([{ ...retry, executionId: "execution-original" }]);
    expect(writes.some((write) => write.sql.includes("INSERT INTO process_queue_jobs") &&
      write.bindings.includes("execution-original"))).toBe(true);
  });

  it("tracks processing, retry, terminal dead-letter, and completion states", async () => {
    const { env, writes } = environment();
    await markQueueProcessing(env, job, 1);
    await markQueueFailure(env, job, 2, new Error("temporary"), false);
    await markQueueFailure(env, job, 5, new Error("terminal"), true);
    await markQueueFinished(env, job, "completed");
    expect(writes.some((write) => write.sql.includes("status = 'processing'"))).toBe(true);
    expect(writes.some((write) => write.bindings.includes("retrying"))).toBe(true);
    expect(writes.some((write) => write.bindings.includes("dead_lettered"))).toBe(true);
    expect(writes.some((write) => write.bindings.includes("completed"))).toBe(true);
  });

  it("does not claim processing after an operator cancellation latch wins the race", async () => {
    const DB = { prepare(sql: string) {
      expect(sql).toContain("cancellation_requested_at IS NULL");
      const statement = {
        bind() { return statement; },
        async run() { return { meta: { changes: 0 } }; },
      };
      return statement;
    } };
    expect(await markQueueProcessing({ DB } as never, job, 1)).toBe(false);
  });

  it("keeps recovery ownership joins tenant scoped", async () => {
    const { env, queries } = environment();
    await getQueueOperations(env, "tenant-1");
    const jobsQuery = queries.find((query) => query.includes("FROM process_queue_jobs q"));
    expect(jobsQuery).toContain("rt.execution_id=q.execution_id AND rt.tenant_id=q.tenant_id");
    expect(jobsQuery).toContain("rm.id=rt.assigned_to AND rm.tenant_id=rt.tenant_id");
  });
});
