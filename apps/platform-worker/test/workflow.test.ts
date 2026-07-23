import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/model", () => ({ runModel: vi.fn() }));
import { runModel } from "../src/model";
import { ProcessWorkflow } from "../src/workflow";

function workflowEnvironment() {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM agent_blueprints")) return { id: "renewal-review", tenant_id: "tenant-1", name: "Renewal Review", description: "Review",
            execution_profile: "workflow", model_profile: "reasoning", prompt_release_id: "prompt-v1", autonomy: "approve", status: "active", tools_json: "[]", updated_at: "now", operating_mode: "active" };
          if (sql.includes("FROM prompt_releases")) return { id: "prompt-v1", blueprint_id: "renewal-review", version: 1, system_prompt: "Review safely",
            instructions_json: "[]", guardrails_json: '["No contract changes"]', checksum: "abc", published_at: "now" };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
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
  });

  it("records a terminal failure before rethrowing to Workflow observability", async () => {
    vi.mocked(runModel).mockRejectedValue(new Error("model unavailable"));
    const { DB, writes } = workflowEnvironment();
    const workflow = new ProcessWorkflow() as ProcessWorkflow & { env: unknown };
    workflow.env = { DB };
    await expect(workflow.run({ instanceId: "execution-2", payload: { tenantId: "tenant-1", request: { blueprintId: "renewal-review", input: "review" } } } as never, step as never)).rejects.toThrow("model unavailable");
    expect(writes.some((write) => write.sql.includes("status = 'failed'") && write.bindings.includes("execution-2"))).toBe(true);
  });
});
