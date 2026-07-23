import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/model", () => ({ runModel: vi.fn() }));
import { runModel } from "../src/model";
import { ProcessWorkflow } from "../src/workflow";

function workflowEnvironment(rules: unknown[] = []) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("SELECT process_release_id FROM executions")) return { process_release_id: "release-v1" };
          if (sql.includes("FROM agent_blueprints")) return { id: "renewal-review", tenant_id: "tenant-1", name: "Renewal Review", description: "Review",
            execution_profile: "workflow", model_profile: "reasoning", prompt_release_id: "prompt-v1",
            resolved_release_id: "release-v1", resolved_prompt_release_id: "prompt-v1",
            resolved_model_profile: "reasoning", resolved_autonomy: "approve",
            autonomy: "approve", status: "active", tools_json: "[]", updated_at: "now", operating_mode: "active" };
          if (sql.includes("FROM prompt_releases")) return { id: "prompt-v1", blueprint_id: "renewal-review", version: 1, system_prompt: "Review safely",
            instructions_json: "[]", guardrails_json: '["No contract changes"]', checksum: "abc", published_at: "now" };
          return null;
        },
        async all() { return { results: rules }; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(items: Array<{ run(): Promise<unknown> }>) {
      for (const item of items) await item.run();
      return [];
    }
  };
  return { DB, writes };
}

const step = { async do<T>(_name: string, optionsOrCallback: unknown, maybeCallback?: () => Promise<T>) {
  const callback = typeof optionsOrCallback === "function" ? optionsOrCallback as () => Promise<T> : maybeCallback!;
  return callback();
} };

describe("durable workflow accounting", () => {
  beforeEach(() => vi.resetAllMocks());

  it("records model usage on the durable execution result", async () => {
    vi.mocked(runModel).mockResolvedValue({ output: "Complete", model: "model-1", inputTokens: 12, outputTokens: 7, totalTokens: 19 });
    const { DB, writes } = workflowEnvironment();
    const workflow = new ProcessWorkflow() as ProcessWorkflow & { env: unknown };
    workflow.env = { DB };
    await workflow.run({ instanceId: "execution-1", payload: { tenantId: "tenant-1", request: { blueprintId: "renewal-review", input: "review" } } } as never, step as never);
    const completion = writes.find((write) => write.sql.includes("status = 'completed'"));
    expect(completion?.bindings).toEqual(expect.arrayContaining([12, 7, 19, "execution-1", "tenant-1"]));
    expect(writes.some((write) => write.sql.includes("UPDATE schedule_dispatches SET status = 'completed'") &&
      write.bindings.includes("execution-1"))).toBe(true);
    expect(writes.some((write) => write.sql.includes("INTO approvals") &&
      write.bindings.includes("execution-1") && write.bindings.includes("approve"))).toBe(true);
    expect(writes.some((write) => write.sql.includes("status='waiting_approval'") &&
      write.bindings.includes("execution-1"))).toBe(true);
  });

  it("records a terminal failure before rethrowing to Workflow observability", async () => {
    vi.mocked(runModel).mockRejectedValue(new Error("model unavailable"));
    const { DB, writes } = workflowEnvironment();
    const workflow = new ProcessWorkflow() as ProcessWorkflow & { env: unknown };
    workflow.env = { DB };
    await expect(workflow.run({ instanceId: "execution-2", payload: { tenantId: "tenant-1", request: { blueprintId: "renewal-review", input: "review" } } } as never, step as never)).rejects.toThrow("model unavailable");
    expect(writes.some((write) => write.sql.includes("UPDATE executions SET status = ?") &&
      write.bindings.includes("failed") && write.bindings.includes("execution-2"))).toBe(true);
    expect(writes.some((write) => write.sql.includes("UPDATE schedule_dispatches SET status = 'failed'") &&
      write.bindings.includes("execution-2"))).toBe(true);
  });

  it("rechecks current DLP policy and blocks before the durable model step", async () => {
    const { DB, writes } = workflowEnvironment([
      { detector: "ssn", action: "block", direction: "both", enabled: 1 }
    ]);
    const workflow = new ProcessWorkflow() as ProcessWorkflow & { env: unknown };
    workflow.env = { DB };
    await expect(workflow.run({ instanceId: "execution-3", payload: {
      tenantId: "tenant-1", request: { blueprintId: "renewal-review", input: "SSN 123-45-6789" }
    } } as never, step as never)).rejects.toThrow("DLP policy blocked");
    expect(runModel).not.toHaveBeenCalled();
    expect(writes.some((write) => write.sql.includes("UPDATE executions SET status = ?") &&
      write.bindings.includes("blocked"))).toBe(true);
  });
});
