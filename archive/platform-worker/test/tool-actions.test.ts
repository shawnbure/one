import { describe, expect, it } from "vitest";
import { cancelToolAction, retryToolAction } from "../src/tool-actions";

type Write = { sql: string; bindings: unknown[] };

function environment(row: Record<string, unknown>, queueFailure = false) {
  const writes: Write[] = [];
  const sent: unknown[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() { return row; },
        async run() {
          writes.push({ sql, bindings });
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    }
  };
  const PROCESS_QUEUE = {
    async send(value: unknown) {
      if (queueFailure) throw new Error("Queue unavailable");
      sent.push(value);
    }
  };
  return { env: { DB, PROCESS_QUEUE } as never, writes, sent };
}

describe("approved tool action operations", () => {
  it("requeues only a terminal failure while preserving the dispatch identity", async () => {
    const { env, writes, sent } = environment({
      execution_id: "run-1", invocation_id: "invocation-1", status: "failed", approval_status: "approved"
    });
    const result = await retryToolAction(env, "tenant-1", "operator-1", "action-1");
    expect(result).toEqual({ updated: true, status: "queued" });
    expect(sent).toEqual([{ kind: "tool_action", tenantId: "tenant-1", dispatchId: "action-1" }]);
    expect(writes.some(({ sql }) => sql.includes("SET status='pending'"))).toBe(true);
    expect(writes.some(({ sql }) => sql.includes("tool_action.retry_requested"))).toBe(false);
    expect(JSON.stringify(writes)).toContain("tool_action.retry_requested");
  });

  it("records enqueue failure for automatic recovery instead of losing the approved action", async () => {
    const { env, writes } = environment({
      execution_id: "run-1", invocation_id: "invocation-1", status: "failed", approval_status: "approved"
    }, true);
    const result = await retryToolAction(env, "tenant-1", "operator-1", "action-1");
    expect(result).toEqual({ updated: true, status: "enqueue_failed" });
    expect(writes.some(({ sql, bindings }) =>
      sql.includes("status='enqueue_failed'") && bindings.includes("Queue unavailable"))).toBe(true);
  });

  it("cancels only pre-provider states and denies the proposed invocation", async () => {
    const { env, writes } = environment({
      execution_id: "run-1", invocation_id: "invocation-1", status: "queued"
    });
    const result = await cancelToolAction(env, "tenant-1", "operator-1", "action-1", "Customer requested stop");
    expect(result).toEqual({ updated: true, status: "rejected" });
    expect(writes.some(({ sql }) => sql.includes("status='denied'"))).toBe(true);
    expect(writes.some(({ sql }) => sql.includes("approved_action_cancelled"))).toBe(true);
    expect(JSON.stringify(writes)).toContain("Customer requested stop");
  });

  it("refuses cancellation once provider processing has started", async () => {
    const { env } = environment({
      execution_id: "run-1", invocation_id: "invocation-1", status: "processing"
    });
    const originalPrepare = (env as { DB: { prepare(sql: string): unknown } }).DB.prepare.bind(
      (env as { DB: { prepare(sql: string): unknown } }).DB
    );
    let calls = 0;
    (env as { DB: { prepare(sql: string): unknown } }).DB.prepare = (sql: string) => {
      const statement = originalPrepare(sql) as {
        bind(...values: unknown[]): unknown; first(): Promise<unknown>; run(): Promise<{ meta: { changes: number } }>;
      };
      if (calls++ === 1) statement.run = async () => ({ meta: { changes: 0 } });
      return statement;
    };
    await expect(cancelToolAction(env, "tenant-1", "operator-1", "action-1"))
      .rejects.toThrow("processing state cannot be cancelled");
  });
});
