import { describe, expect, it } from "vitest";
import { enqueueProcessJob, markQueueFailure, markQueueFinished, markQueueProcessing } from "../src/queue-operations";

function environment(sendError?: Error) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const sent: unknown[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; },
      };
      return statement;
    },
  };
  const PROCESS_QUEUE = { async send(job: unknown) {
    if (sendError) throw sendError;
    sent.push(job);
  } };
  return { env: { DB, PROCESS_QUEUE } as never, writes, sent };
}

const job = { blueprintId: "process-1", input: "safe input", executionId: "execution-1",
  attempt: 0, tenantId: "tenant-1" };

describe("Queue lifecycle evidence", () => {
  it("persists tenant-scoped evidence before Queue handoff", async () => {
    const { env, writes, sent } = environment();
    await enqueueProcessJob(env, job, "webhook");
    expect(sent).toEqual([job]);
    expect(writes[0]?.sql).toContain("INSERT INTO process_queue_jobs");
    expect(writes[0]?.bindings).toEqual(expect.arrayContaining(["tenant-1", "execution-1", "process-1", "webhook"]));
  });

  it("preserves an enqueue failure for operator diagnosis", async () => {
    const { env, writes } = environment(new Error("Queue unavailable"));
    await expect(enqueueProcessJob(env, job, "api")).rejects.toThrow("Queue unavailable");
    expect(writes.some((write) => write.sql.includes("status = 'enqueue_failed'") &&
      write.bindings.includes("Queue unavailable"))).toBe(true);
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
});
