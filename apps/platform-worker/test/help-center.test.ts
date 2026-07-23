import { describe, expect, it } from "vitest";
import { acknowledgeLearning, getHelpCenter } from "../src/help-center";

function environment() {
  const acknowledgements = new Map<string, string>();
  const bindingsSeen: unknown[][] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; bindingsSeen.push(values); return statement; },
        async all() {
          if (sql.includes("FROM agent_blueprints")) return { results: [
            { id: "instant-1", name: "Classify intake", description: "Classify a request", execution_profile: "instant",
              autonomy: "suggest", status: "active", business_owner: "Operations", department: "Service",
              risk_level: "low", purpose: "Route incoming requests.", current_steps: "Read input; Classify; Route" },
            { id: "thread-1", name: "Customer conversation", description: "Assist a customer", execution_profile: "conversation",
              autonomy: "approve", status: "paused", business_owner: "Customer Operations", department: "Service",
              risk_level: "medium", purpose: "Prepare a response.", current_steps: null }
          ] };
          if (sql.includes("FROM learning_acknowledgements")) {
            const [tenantId, actorId] = bindings.map(String);
            return { results: [...acknowledgements.entries()]
              .filter(([key]) => key.startsWith(`${tenantId}:${actorId}:`))
              .map(([key, acknowledged_at]) => {
                const [, , module_id, module_version] = key.split(":");
                return { module_id, module_version: Number(module_version), acknowledged_at };
              }) };
          }
          return { results: [] };
        },
        async first() {
          if (!sql.includes("SELECT acknowledged_at")) return null;
          const [tenantId, actorId, moduleId, version] = bindings.map(String);
          const acknowledged_at = acknowledgements.get(`${tenantId}:${actorId}:${moduleId}:${version}`);
          return acknowledged_at ? { acknowledged_at } : null;
        },
        async run() {
          if (!sql.includes("INSERT OR IGNORE INTO learning_acknowledgements")) return { meta: { changes: 1 } };
          const [, tenantId, actorId, moduleId, version] = bindings.map(String);
          const key = `${tenantId}:${actorId}:${moduleId}:${version}`;
          if (acknowledgements.has(key)) return { meta: { changes: 0 } };
          acknowledgements.set(key, "2026-07-23T12:00:00.000Z");
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  return { env: { DB }, acknowledgements, bindingsSeen };
}

describe("role-specific Help Center", () => {
  it("returns only applicable learning and explains process state boundaries", async () => {
    const { env, bindingsSeen } = environment();
    const result = await getHelpCenter(env as never, "tenant-a", "operator-a", "operator");
    expect(result.roleGuide.title).toBe("Operator");
    expect(result.modules.map((module) => module.id)).toEqual([
      "private-ai-basics", "operator-response", "human-review"
    ]);
    expect(result.progress).toEqual({ completed: 0, total: 3 });
    expect(result.processRunbooks.find((item) => item.id === "instant-1")?.memory)
      .toContain("no sticky agent conversation state");
    expect(result.processRunbooks.find((item) => item.id === "thread-1")?.memory)
      .toContain("Durable actor");
    expect(result.processRunbooks.find((item) => item.id === "thread-1")?.start)
      .toContain("paused");
    expect(bindingsSeen.filter((values) => values[0] === "tenant-a").length).toBe(2);
  });

  it("records an acknowledgement once and scopes it to tenant, actor, role, and version", async () => {
    const { env, acknowledgements } = environment();
    const first = await acknowledgeLearning(env as never, "tenant-a", "operator-a", "operator",
      "operator-response", 1);
    const retry = await acknowledgeLearning(env as never, "tenant-a", "operator-a", "operator",
      "operator-response", 1);
    expect(first).toMatchObject({ recorded: true, moduleId: "operator-response", version: 1 });
    expect(retry).toMatchObject({ recorded: false, acknowledgedAt: first.acknowledgedAt });
    expect(acknowledgements.size).toBe(1);
    await expect(acknowledgeLearning(env as never, "tenant-a", "viewer-a", "viewer",
      "operator-response", 1)).rejects.toThrow("not available");
    await expect(acknowledgeLearning(env as never, "tenant-b", "operator-b", "operator",
      "operator-response", 2)).rejects.toThrow("not available");
  });

  it("reports only the signed-in actor's training progress", async () => {
    const { env, acknowledgements } = environment();
    acknowledgements.set("tenant-a:operator-a:operator-response:1", "2026-07-23T12:00:00.000Z");
    acknowledgements.set("tenant-a:other-actor:private-ai-basics:1", "2026-07-23T12:00:00.000Z");
    acknowledgements.set("tenant-b:operator-a:private-ai-basics:1", "2026-07-23T12:00:00.000Z");
    const result = await getHelpCenter(env as never, "tenant-a", "operator-a", "operator");
    expect(result.progress).toEqual({ completed: 1, total: 3 });
    expect(result.modules.find((module) => module.id === "operator-response")?.acknowledgedAt).toBeTruthy();
    expect(result.modules.find((module) => module.id === "private-ai-basics")?.acknowledgedAt).toBeNull();
  });
});
