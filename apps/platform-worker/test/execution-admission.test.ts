import { describe, expect, it } from "vitest";
import { assertAsyncExecutionAdmission, executeRequest } from "../src/execution";

function executionEnvironment(tenantMode: string, processMode: string, processStatus = "active") {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first() {
          if (sql.includes("FROM agent_blueprints")) return {
            id: "process-1", tenant_id: "tenant-1", name: "Intake", description: "Test", execution_profile: "instant",
            model_profile: "fast", prompt_release_id: "prompt-1", autonomy: "suggest", status: processStatus,
            tools_json: "[]", updated_at: "now", operating_mode: processMode
          };
          if (sql.includes("tenant_operating_controls")) return { mode: tenantMode };
          if (sql.includes("tenant_budgets")) return null;
          return null;
        },
        async run() { writes.push({ sql, values }); return { meta: { changes: 1 } }; }
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
});
