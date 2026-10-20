import { describe, expect, it, vi } from "vitest";
import { createActorReleaseRollout } from "../src/actor-release-rollouts";

function environment(evaluationStatus = "passing") {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const create = vi.fn(async () => ({ id: "workflow-1" }));
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM agent_blueprints b")) return {
            active_release_id: "release-v3", execution_profile: "conversation",
            release_status: "published", evaluation_status: evaluationStatus, version: 3
          };
          if (sql.includes("FROM actor_release_rollouts") && sql.includes("status IN")) return null;
          if (sql.includes("SELECT COUNT(*) actor_count")) return { actor_count: 5 };
          return null;
        },
        async all() {
          if (sql.includes("SELECT execution_id, instance_key")) return { results: [
            { execution_id: "execution-1", instance_key: "process-1:thread:one", effective_release_id: "release-v2" },
            { execution_id: "execution-2", instance_key: "process-1:thread:two", effective_release_id: "release-v2" }
          ] };
          return { results: [] };
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: { DB, ACTOR_RELEASE_ROLLOUT: { create } } as never, writes, create };
}

describe("actor release rollout admission", () => {
  it("snapshots a deterministic bounded cohort and starts its Workflow", async () => {
    const { env, writes, create } = environment();
    const result = await createActorReleaseRollout(env, "tenant-1", "owner-1", "process-1", {
      percentage: 25, targetReleaseId: "release-v3",
      reason: "Adopt the evaluated release in a staged cohort."
    });
    expect(result).toMatchObject({ status: "queued", eligibleActors: 5, selectedActorCount: 2 });
    expect(writes.filter(({ sql }) => sql.includes("INSERT INTO actor_release_rollout_items"))).toHaveLength(2);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ tenantId: "tenant-1", actorId: "owner-1" })
    }));
  });

  it("requires passing target-release evaluation evidence", async () => {
    const { env, create } = environment("not_run");
    await expect(createActorReleaseRollout(env, "tenant-1", "owner-1", "process-1", {
      percentage: 25, targetReleaseId: "release-v3",
      reason: "Adopt the evaluated release in a staged cohort."
    })).rejects.toThrow("passing evaluation");
    expect(create).not.toHaveBeenCalled();
  });
});
