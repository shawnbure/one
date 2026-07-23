import { describe, expect, it } from "vitest";
import { createMcpConnector, governMcpTool } from "../src/mcp-connectors";

function environment() {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first() {
          if (sql.includes("FROM mcp_connector_tools")) return { id: "mcp-tool-1", revision: 3 };
          if (sql.includes("COUNT(*) count FROM agent_blueprints")) return { count: 1 };
          return null;
        },
        async all() { return { results: [] }; },
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

describe("governed MCP connectors", () => {
  it("registers only public HTTPS services and never accepts embedded credentials", async () => {
    const { env, writes } = environment();
    await expect(createMcpConnector(env, "tenant-1", "owner-1", {
      name: "Private CRM", serverUrl: "http://mcp.example.com"
    })).rejects.toThrow("must use HTTPS");
    await expect(createMcpConnector(env, "tenant-1", "owner-1", {
      name: "Private CRM", serverUrl: "https://user:secret@mcp.example.com"
    })).rejects.toThrow("embedded credentials");
    await expect(createMcpConnector(env, "tenant-1", "owner-1", {
      name: "Private CRM", serverUrl: "https://127.0.0.1/mcp"
    })).rejects.toThrow("private or metadata");
    const created = await createMcpConnector(env, "tenant-1", "owner-1", {
      name: "Private CRM", serverUrl: "https://mcp.customer.example/mcp?token=discarded"
    });
    expect(created).toMatchObject({ status: "disabled", transport: "streamable-http" });
    expect(writes.at(-1)?.values).toContain("https://mcp.customer.example/mcp");
    expect(JSON.stringify(writes)).not.toContain("discarded");
  });

  it("requires an exact revision and tenant-scoped process references before enablement", async () => {
    const { env, writes } = environment();
    await expect(governMcpTool(env, "tenant-1", "owner-1", "mcp-tool-1", {
      enabled: true, accessMode: "read", riskLevel: "low", dataClassification: "internal",
      owner: "Customer Operations", rateLimitPerMinute: 30, processIds: ["process-1"],
      expectedRevision: 2
    })).rejects.toThrow("changed");
    const result = await governMcpTool(env, "tenant-1", "owner-1", "mcp-tool-1", {
      enabled: true, accessMode: "read", riskLevel: "low", dataClassification: "internal",
      owner: "Customer Operations", rateLimitPerMinute: 30, processIds: ["process-1"],
      expectedRevision: 3
    });
    expect(result).toEqual({ id: "mcp-tool-1", enabled: true, processCount: 1, revision: 4 });
    expect(writes.some(({ sql, values }) => sql.includes("UPDATE mcp_connector_tools") &&
      values.includes("tenant-1") && values.includes(3))).toBe(true);
  });
});
