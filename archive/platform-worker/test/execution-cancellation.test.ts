import { describe, expect, it } from "vitest";
import { acknowledgeCancelledQueueJob, cancelQueuedExecution,
  ExecutionCancellationConflict } from "../src/execution-cancellation";

function environment(input: {
  profile?: string;
  status?: string;
  queueStatus?: string | null;
  workflowStatus?: string;
} = {}) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  let terminated = false;
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("LEFT JOIN process_queue_jobs")) return {
            id: "execution-1",
            execution_profile: input.profile ?? "instant",
            status: input.status ?? "queued",
            queue_status: input.queueStatus === undefined ? "queued" : input.queueStatus,
          };
          if (sql.includes("SELECT status FROM executions")) {
            return { status: input.status ?? "cancelled" };
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          writes.push({ sql, bindings });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  const PROCESS_WORKFLOW = {
    async get(id: string) {
      expect(id).toBe("execution-1");
      return {
        async status() { return { status: input.workflowStatus ?? "queued" }; },
        async terminate(options: unknown) {
          expect(options).toEqual({ rollback: true });
          terminated = true;
        },
      };
    },
  };
  return {
    env: { DB, PROCESS_WORKFLOW } as never,
    writes,
    wasTerminated: () => terminated,
  };
}

describe("governed queued execution cancellation", () => {
  it("terminates a queued Cloudflare Workflow before recording cancellation", async () => {
    const context = environment({ profile: "workflow", queueStatus: null });
    const result = await cancelQueuedExecution(context.env, "tenant-1", "operator-1",
      "execution-1", { reason: "Customer withdrew this scheduled request" });
    expect(context.wasTerminated()).toBe(true);
    expect(result).toMatchObject({ status: "cancelled", executionProfile: "workflow" });
    expect(context.writes).toHaveLength(1);
    expect(context.writes[0]?.sql).toContain("status='cancelled'");
    expect(context.writes[0]?.bindings).toEqual(expect.arrayContaining([
      "operator-1", "tenant-1", "execution-1",
    ]));
  });

  it("latches Queue cancellation so delivery becomes a no-op", async () => {
    const context = environment({ profile: "instant", queueStatus: "retrying" });
    await cancelQueuedExecution(context.env, "tenant-1", "operator-1",
      "execution-1", { reason: "Duplicate upstream request should not proceed" });
    expect(context.writes.some((write) =>
      write.sql.includes("cancellation_requested_at") &&
      write.bindings.includes("Duplicate upstream request should not proceed"),
    )).toBe(true);
  });

  it("refuses cancellation after work has started", async () => {
    const running = environment({ status: "running" });
    await expect(cancelQueuedExecution(running.env, "tenant-1", "operator-1",
      "execution-1", { reason: "This request is no longer required" }))
      .rejects.toBeInstanceOf(ExecutionCancellationConflict);
    const processing = environment({ profile: "instant", queueStatus: "processing" });
    await expect(cancelQueuedExecution(processing.env, "tenant-1", "operator-1",
      "execution-1", { reason: "This request is no longer required" }))
      .rejects.toThrow("already started");
  });

  it("acknowledges a cancelled Queue message without executing it", async () => {
    const context = environment({ status: "cancelled" });
    const acknowledged = await acknowledgeCancelledQueueJob(context.env, {
      blueprintId: "process-1", input: "private input", executionId: "execution-1",
      attempt: 0, tenantId: "tenant-1",
    });
    expect(acknowledged).toBe(true);
    expect(context.writes.some((write) =>
      write.sql.includes("completion_disposition='cancelled'"),
    )).toBe(true);
    expect(context.writes.some((write) =>
      write.sql.includes("UPDATE schedule_dispatches SET status='completed'"),
    )).toBe(true);
  });

  it("requires a substantive bounded cancellation reason", async () => {
    const context = environment();
    await expect(cancelQueuedExecution(context.env, "tenant-1", "operator-1",
      "execution-1", { reason: "stop" })).rejects.toThrow("10 to 500");
  });
});
