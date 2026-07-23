import { describe, expect, it } from "vitest";
import { createTool, releaseToolPolicies } from "../src/tools";

function toolEnvironment(rows: Array<Record<string, unknown>> = []) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first() { return null; },
        async all() { return { results: rows }; },
        async run() { writes.push({ sql, values }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    }
  };
  return { env: { DB } as never, writes };
}

describe("typed tool governance", () => {
  it("stores bounded schemas and governance metadata without credentials", async () => {
    const { env, writes } = toolEnvironment();
    const result = await createTool(env, "tenant-1", "builder-1", {
      name: "lookup_account",
      description: "Read one approved customer account by identifier.",
      owner: "Customer Operations",
      accessMode: "read",
      riskLevel: "low",
      inputSchema: { type: "object", required: ["accountId"], properties: { accountId: { type: "string" } } },
      outputSchema: { type: "object", properties: { found: { type: "boolean" } } },
      rateLimitPerMinute: 30
    });
    expect(result).toMatchObject({ name: "lookup_account", processCount: 0 });
    const insert = writes.find(({ sql }) => sql.includes("INSERT INTO tool_definitions"));
    expect(insert?.values).toEqual(expect.arrayContaining([
      "tenant-1", "lookup_account", "read", "low", "Customer Operations", 30
    ]));
    expect(JSON.stringify(insert?.values)).not.toContain("secret");
  });

  it("rejects unsafe or malformed tool schemas before D1 writes", async () => {
    const { env, writes } = toolEnvironment();
    await expect(createTool(env, "tenant-1", "builder-1", {
      name: "bad_tool",
      description: "Invalid recursive schema should be rejected.",
      owner: "Operations",
      accessMode: "read",
      riskLevel: "low",
      inputSchema: { type: "object", $ref: "https://example.com/schema" }
    })).rejects.toThrow("cannot use external or recursive references");
    expect(writes).toHaveLength(0);
  });

  it("maps immutable release policy rows into typed readiness evidence", async () => {
    const { env } = toolEnvironment([{
      id: "tool-1", name: "update_crm", version: 2, adapter_kind: "http", access_mode: "write",
      risk_level: "high", connection_id: "connection-1", connection_ready: 0,
      data_classification: "confidential", rate_limit_per_minute: 10,
      input_schema_json: '{"type":"object"}', output_schema_json: '{"type":"object"}'
    }]);
    await expect(releaseToolPolicies(env, "tenant-1", "process-1")).resolves.toEqual([
      expect.objectContaining({
        id: "tool-1", name: "update_crm", accessMode: "write", riskLevel: "high",
        connectionReady: false, rateLimitPerMinute: 10
      })
    ]);
  });
});
