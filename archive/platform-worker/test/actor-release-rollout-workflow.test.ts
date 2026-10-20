import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/actor-release-migration", () => ({ migrateExecutionActorRelease: vi.fn() }));
vi.mock("../src/notifications", () => ({ emitNotification: vi.fn() }));
import { migrateExecutionActorRelease } from "../src/actor-release-migration";
import { ActorReleaseRolloutWorkflow } from "../src/actor-release-rollout-workflow";

function environment() {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("SELECT id, blueprint_id")) return {
            id: "rollout-1", blueprint_id: "process-1", target_release_id: "release-v3",
            reason: "Adopt the evaluated release in a staged cohort."
          };
          if (sql.includes("SUM(CASE WHEN status='completed'")) return {
            completed_count: 1, skipped_count: 0, failed_count: 0
          };
          return null;
        },
        async all() {
          if (sql.includes("FROM actor_release_rollout_items")) return { results: [{
            id: "item-1", source_execution_id: "execution-1", instance_key: "process-1:thread:one",
            from_release_id: "release-v2", to_release_id: "release-v3"
          }] };
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
  return { DB, writes };
}

const step = { async do<T>(_name: string, optionsOrCallback: unknown, maybeCallback?: () => Promise<T>) {
  const callback = typeof optionsOrCallback === "function" ? optionsOrCallback as () => Promise<T> : maybeCallback!;
  return callback();
} };

describe("actor release rollout Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(migrateExecutionActorRelease).mockResolvedValue({
      id: "migration-1", changed: true, fromReleaseId: "release-v2", toReleaseId: "release-v3",
      targetVersion: 3, migratedAt: "now"
    });
  });

  it("migrates the snapshotted actor and records the aggregate outcome", async () => {
    const { DB, writes } = environment();
    const workflow = new ActorReleaseRolloutWorkflow() as ActorReleaseRolloutWorkflow & { env: unknown };
    workflow.env = { DB };
    const result = await workflow.run({ instanceId: "rollout-1", payload: {
      tenantId: "tenant-1", actorId: "owner-1", rolloutId: "rollout-1"
    } } as never, step as never);
    expect(migrateExecutionActorRelease).toHaveBeenCalledWith(expect.anything(), "tenant-1", "owner-1",
      "execution-1", expect.objectContaining({
        targetReleaseId: "release-v3", confirmFromReleaseId: "release-v2"
      }));
    expect(result).toMatchObject({ status: "completed", completed: 1, failed: 0 });
    expect(writes.some(({ sql, bindings }) => sql.includes("UPDATE actor_release_rollouts SET status=?") &&
      bindings.includes("completed"))).toBe(true);
  });
});
