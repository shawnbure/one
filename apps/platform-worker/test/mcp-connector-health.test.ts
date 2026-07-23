import { beforeEach, describe, expect, it, vi } from "vitest";

const { actor, emitNotification } = vi.hoisted(() => ({
  actor: { inspectConnector: vi.fn() },
  emitNotification: vi.fn(async () => ["event-1"])
}));
vi.mock("agents", () => ({ getAgentByName: vi.fn(async () => actor) }));
vi.mock("../src/notifications", () => ({ emitNotification }));

import { checkMcpConnectorHealth } from "../src/mcp-connector-health";

function environment(alertedAt: string | null = null) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async all() {
          if (sql.includes("FROM mcp_connectors")) return { results: [{
            id: "mcp-1", tenant_id: "tenant-1", name: "Private CRM", health_alerted_at: alertedAt
          }] };
          return { results: [] };
        },
        async run() { writes.push({ sql, values }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    }
  };
  return { env: { DB, MCP_CONNECTOR: {} } as never, writes };
}

describe("MCP connector health maintenance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records healthy durable sessions without creating an alert", async () => {
    actor.inspectConnector.mockResolvedValue({
      servers: [{ id: "server-1", name: "Private CRM", state: "ready", error: null }], tools: []
    });
    const { env, writes } = environment();
    await expect(checkMcpConnectorHealth(env, new Date("2026-07-23T23:00:00Z")))
      .resolves.toEqual({ checked: 1, healthy: 1, attention: 0, alerted: 0 });
    expect(writes.some(({ sql }) => sql.includes("last_success_at"))).toBe(true);
    expect(emitNotification).not.toHaveBeenCalled();
  });

  it("fails closed, disables capabilities, and emits one bounded accountable alert", async () => {
    actor.inspectConnector.mockResolvedValue({
      servers: [{ id: "server-1", name: "Private CRM", state: "failed",
        error: "provider failed at https://private.example/token/abcdefghijklmnopqrstuvwxyz" }], tools: []
    });
    const { env, writes } = environment();
    await expect(checkMcpConnectorHealth(env, new Date("2026-07-23T23:00:00Z")))
      .resolves.toEqual({ checked: 1, healthy: 0, attention: 1, alerted: 1 });
    expect(writes.some(({ sql }) => sql.includes("UPDATE mcp_connector_tools SET enabled=0"))).toBe(true);
    expect(JSON.stringify(writes)).not.toContain("private.example");
    expect(emitNotification).toHaveBeenCalledWith(env, "tenant-1", expect.objectContaining({
      eventType: "connection.mcp_attention", targetId: "mcp-1"
    }));
  });

  it("does not repeat a health alert inside the 24-hour cooldown", async () => {
    actor.inspectConnector.mockRejectedValue(new Error("connection unavailable"));
    const { env } = environment("2026-07-23T12:00:00Z");
    await expect(checkMcpConnectorHealth(env, new Date("2026-07-23T23:00:00Z")))
      .resolves.toMatchObject({ attention: 1, alerted: 0 });
    expect(emitNotification).not.toHaveBeenCalled();
  });
});
