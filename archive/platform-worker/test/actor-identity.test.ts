import { describe, expect, it } from "vitest";
import { upgradeActorIdentity } from "../src/actor-identity";

function environment(options: {
  profile?: string;
  version?: number;
  mode?: string;
  actorCount?: number;
  updateChanges?: number;
} = {}) {
  const queries: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          queries.push({ sql, bindings });
          return statement;
        },
        async first() {
          if (sql.includes("FROM agent_blueprints")) return {
            id: "process-1",
            execution_profile: options.profile ?? "conversation",
            actor_identity_version: options.version ?? 1,
            operating_mode: options.mode ?? "paused",
          };
          if (sql.includes("COUNT(*) count FROM executions")) return {
            count: options.actorCount ?? 0,
          };
          return null;
        },
        async run() {
          return { meta: { changes: options.updateChanges ?? 1 } };
        },
      };
      return statement;
    },
  };
  return { env: { DB } as never, queries };
}

const input = {
  reason: "No durable actor has been created for this paused process.",
  confirmation: "UPGRADE ACTOR IDENTITY",
};

describe("durable actor identity upgrade", () => {
  it("upgrades only the tenant process while rechecking actor evidence in the write", async () => {
    const { env, queries } = environment();
    const result = await upgradeActorIdentity(env, "tenant-1", "process-1", input);
    expect(result).toMatchObject({ changed: true, version: 2 });
    const update = queries.find((query) => query.sql.includes("SET actor_identity_version=2"));
    expect(update?.sql).toContain("NOT EXISTS");
    expect(update?.sql).toContain("operating_mode='paused'");
    expect(update?.bindings).toEqual(["process-1", "tenant-1", "tenant-1", "process-1"]);
  });

  it("preserves any process with known durable actor evidence", async () => {
    const { env, queries } = environment({ actorCount: 1 });
    await expect(upgradeActorIdentity(env, "tenant-1", "process-1", input))
      .rejects.toThrow("Existing durable actor evidence");
    expect(queries.some((query) => query.sql.includes("SET actor_identity_version=2"))).toBe(false);
  });

  it("requires explicit containment before the identity transition", async () => {
    const { env } = environment({ mode: "active" });
    await expect(upgradeActorIdentity(env, "tenant-1", "process-1", input))
      .rejects.toThrow("Pause the process");
  });

  it("leaves instant and Workflow processes without invented actor identity", async () => {
    const { env } = environment({ profile: "instant" });
    await expect(upgradeActorIdentity(env, "tenant-1", "process-1", input))
      .rejects.toThrow("do not have a durable actor identity");
  });
});
