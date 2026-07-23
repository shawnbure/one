import { describe, expect, it } from "vitest";
import type { ToolPolicy } from "@workrr/contracts";
import { buildExecutionTools, toolExecutionMode } from "../src/tool-runtime";

const policy: ToolPolicy = {
  id: "tool-1",
  name: "lookup_customer",
  version: 1,
  adapterKind: "mock",
  accessMode: "read",
  riskLevel: "low",
  connectionId: null,
  connectionReady: true,
  dataClassification: "internal",
  rateLimitPerMinute: 60,
  inputSchemaJson: '{"type":"object"}',
  outputSchemaJson: '{"type":"object"}'
};

describe("governed tool runtime", () => {
  it("only simulates ready low-risk mock reads", () => {
    expect(toolExecutionMode(policy)).toBe("simulation");
    expect(toolExecutionMode({ ...policy, accessMode: "write" })).toBe("proposal_only");
    expect(toolExecutionMode({ ...policy, riskLevel: "medium" })).toBe("proposal_only");
    expect(toolExecutionMode({ ...policy, connectionReady: false })).toBe("proposal_only");
    expect(toolExecutionMode({ ...policy, adapterKind: "http", connectionId: "conn-1" })).toBe("proposal_only");
    expect(toolExecutionMode({ ...policy, adapterKind: "microsoft", connectionId: "conn-ms",
      handlerKey: "microsoft.profile.get" })).toBe("bound");
    expect(toolExecutionMode({ ...policy, adapterKind: "microsoft", connectionId: "conn-ms",
      handlerKey: "microsoft.profile.get" }, "approve")).toBe("proposal_only");
    const mcp = { ...policy, adapterKind: "mcp" as const, connectionId: "mcp-1",
      handlerKey: "mcp.mcp-1.tool_workrr_lookup" };
    expect(toolExecutionMode(mcp)).toBe("bound");
    expect(toolExecutionMode({ ...mcp, riskLevel: "medium" })).toBe("proposal_only");
    expect(toolExecutionMode({ ...mcp, accessMode: "write" })).toBe("proposal_only");
    expect(toolExecutionMode({ ...mcp, connectionReady: false })).toBe("proposal_only");
    expect(toolExecutionMode(mcp, "approve")).toBe("proposal_only");
  });

  it("does not expose executable tools at advisory autonomy levels", () => {
    const env = {} as Parameters<typeof buildExecutionTools>[0];
    expect(buildExecutionTools(env).tools).toBeUndefined();
    expect(buildExecutionTools(env, {
      tenantId: "demo", executionId: "run-1", autonomy: "suggest", policies: [policy]
    }).tools).toBeUndefined();
  });

  it("bounds the exposed catalog", () => {
    const env = {} as Parameters<typeof buildExecutionTools>[0];
    const policies = Array.from({ length: 24 }, (_, index) => ({
      ...policy, id: `tool-${index}`, name: `lookup_${index}`
    }));
    const runtime = buildExecutionTools(env, {
      tenantId: "demo", executionId: "run-1", autonomy: "guarded", policies
    });
    expect(Object.keys(runtime.tools ?? {})).toHaveLength(20);
  });

  it("records safe simulation evidence and reuses it by idempotency key", async () => {
    const rows = new Map<string, { status: "simulated"; execution_mode: "simulation";
      output_json: string; error: null }>();
    let inserts = 0;
    const DB = {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...next: unknown[]) { values = next; return statement; },
          async first() {
            if (sql.includes("FROM tool_invocations WHERE")) return rows.get(String(values[1])) ?? null;
            if (sql.includes("COUNT(*) count FROM tool_invocations")) return { count: 0 };
            return null;
          },
          async all() { return { results: [] }; },
          async run() {
            if (sql.includes("INSERT INTO tool_invocations")) {
              inserts += 1;
              rows.set(String(values[16]), {
                status: "simulated", execution_mode: "simulation",
                output_json: String(values[14]), error: null
              });
            }
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
    const runtime = buildExecutionTools({ DB } as never, {
      tenantId: "demo", executionId: "run-1", autonomy: "guarded", policies: [policy]
    });
    const selected = runtime.tools?.lookup_customer;
    const execute = selected?.execute;
    expect(execute).toBeTypeOf("function");
    const options = { toolCallId: "call-1", messages: [] } as never;
    const first = await execute!({ accountId: "A-1" }, options);
    const replay = await execute!({ accountId: "A-1" }, options);
    expect(first).toMatchObject({ status: "simulated" });
    expect(replay).toEqual(first);
    expect(inserts).toBe(1);
    expect(runtime.evidence).toHaveLength(2);
  });
});
