import { describe, expect, it } from "vitest";
import { assertAsyncExecutionAdmission, executeRequest } from "../src/execution";

function executionEnvironment(tenantMode: string, processMode: string, processStatus = "active",
  inputSchemaJson: string | null = null, autonomy = "suggest", existingExecution?: {
    id: string; status: string; output_preview: string | null; model: string | null;
  }) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first() {
          if (sql.includes("FROM agent_blueprints")) return {
            id: "process-1", tenant_id: "tenant-1", name: "Intake", description: "Test", execution_profile: "instant",
            model_profile: "fast", prompt_release_id: "prompt-1", autonomy, status: processStatus,
            tools_json: "[]", updated_at: "now", operating_mode: processMode,
            active_release_id: "release-1", input_schema_json: inputSchemaJson, output_schema_json: null
          };
          if (sql.includes("tenant_operating_controls")) return { mode: tenantMode };
          if (sql.includes("tenant_budgets")) return null;
          if (sql.includes("FROM executions WHERE")) return existingExecution ? {
            ...existingExecution, blueprint_id: "process-1", instance_key: null,
            execution_profile: "instant", started_at: "earlier"
          } : null;
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          writes.push({ sql, values });
          return { meta: { changes: existingExecution && sql.includes("INSERT OR IGNORE INTO executions") ? 0 : 1 } };
        }
      };
      return statement;
    }
  };
  return { env: { DB } as never, writes };
}

describe("execution admission controls", () => {
  it("rejects async queue admission during tenant emergency stop", async () => {
    const { env } = executionEnvironment("emergency_stop", "active");
    await expect(assertAsyncExecutionAdmission(env, "tenant-1", "process-1")).rejects.toThrow("Tenant is in emergency stop");
  });

  it("rejects new work while the tenant is draining", async () => {
    const { env } = executionEnvironment("drain", "active");
    await expect(assertAsyncExecutionAdmission(env, "tenant-1", "process-1")).rejects.toThrow("draining");
  });

  it("records paused-process input as deferred without invoking a model", async () => {
    const { env, writes } = executionEnvironment("active", "paused");
    const result = await executeRequest(env, "tenant-1", { blueprintId: "process-1", input: "Preserve this request" }, "execution-1");
    expect(result.status).toBe("deferred");
    expect(writes.some(({ sql, values }) => sql.includes("INSERT OR IGNORE INTO executions") && values.includes("deferred"))).toBe(true);
    expect(writes.some(({ sql }) => sql.includes("prompt_releases"))).toBe(false);
  });

  it("records schema-invalid synchronous input as blocked before model spend", async () => {
    const contract = JSON.stringify({ type: "object", additionalProperties: false, required: ["caseId"],
      properties: { caseId: { type: "string", minLength: 1 } } });
    const { env, writes } = executionEnvironment("active", "active", "active", contract);
    await expect(executeRequest(env, "tenant-1", { blueprintId: "process-1", input: '{"wrong":"value"}' }, "execution-contract"))
      .rejects.toThrow("Input contract rejected");
    const record = writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO executions"));
    expect(record?.sql).toContain("'blocked'");
    expect(record?.sql).toContain("'failed'");
    expect(record?.values).toContain("release-1");
    expect(writes.some(({ sql }) => sql.includes("prompt_releases"))).toBe(false);
  });

  it("records observe-mode work with zero model usage and never loads the prompt", async () => {
    const { env, writes } = executionEnvironment("active", "active", "active", null, "observe");
    const result = await executeRequest(env, "tenant-1",
      { blueprintId: "process-1", input: "Record this request" }, "execution-observe");
    expect(result).toMatchObject({ status: "completed", output: expect.stringContaining("does not generate") });
    expect(writes.some(({ sql, values }) => sql.includes("input_tokens=0") &&
      values.includes("execution-observe"))).toBe(true);
    expect(writes.some(({ sql }) => sql.includes("FROM prompt_releases"))).toBe(false);
  });

  it("settles unexpected synchronous failures instead of leaving a run permanently active", async () => {
    const { env, writes } = executionEnvironment("active", "active");
    await expect(executeRequest(env, "tenant-1",
      { blueprintId: "process-1", input: "Run with a missing prompt fixture" }, "execution-unexpected"))
      .rejects.toThrow("Published prompt release not found");
    const failure = writes.find(({ sql, values }) => sql.includes("status='failed'") &&
      values.includes("execution-unexpected"));
    expect(failure?.sql).toContain("status IN ('running','queued','completed')");
    expect(failure?.values).toContain("tenant-1");
  });

  it("returns the claimed execution on an idempotent retry without loading a prompt or model", async () => {
    const { env, writes } = executionEnvironment("active", "active", "active", null, "suggest", {
      id: "execution-original", status: "completed", output_preview: "Already completed", model: "model-1"
    });
    const result = await executeRequest(env, "tenant-1", {
      blueprintId: "process-1", input: "Retry this request", idempotencyKey: "customer-job-42"
    }, "execution-retry");
    expect(result).toMatchObject({
      executionId: "execution-original", status: "completed", output: "Already completed",
      idempotentReplay: true
    });
    expect(writes.some(({ sql }) => sql.includes("prompt_releases"))).toBe(false);
    expect(writes.some(({ sql }) => sql.includes("output_preview=?"))).toBe(false);
  });

  it("rejects empty and oversized idempotency keys before doing database work", async () => {
    const { env, writes } = executionEnvironment("active", "active");
    await expect(executeRequest(env, "tenant-1", {
      blueprintId: "process-1", input: "input", idempotencyKey: " "
    })).rejects.toThrow("cannot be empty");
    await expect(executeRequest(env, "tenant-1", {
      blueprintId: "process-1", input: "input", idempotencyKey: "x".repeat(201)
    })).rejects.toThrow("limited to 200");
    expect(writes).toHaveLength(0);
  });
});
