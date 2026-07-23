import { beforeEach, describe, expect, it, vi } from "vitest";

const agent = {
  bindTenant: vi.fn(),
  pinnedReleaseId: vi.fn(),
  pinnedPromptReleaseId: vi.fn(),
  adoptProcessRelease: vi.fn(),
  migratePromptBundle: vi.fn()
};
vi.mock("agents", () => ({ getAgentByName: vi.fn(async () => agent) }));
vi.mock("../src/repository", () => ({ getPromptBundle: vi.fn() }));

import { getPromptBundle } from "../src/repository";
import { migrateExecutionActorRelease } from "../src/actor-release-migration";

function environment() {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM executions e")) return {
            blueprint_id: "process-1", execution_profile: "conversation",
            instance_key: "process-1:thread:customer-42", process_release_id: "release-v1",
            source_prompt_release_id: "prompt-v1",
            active_release_id: "release-v2", prompt_release_id: "prompt-v2", version: 2,
            target_status: "published", evaluation_status: "passing"
          };
          return null;
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    }
  };
  return { env: { DB, PROCESS_AGENT: {} } as never, writes };
}

describe("explicit actor release migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agent.pinnedReleaseId.mockResolvedValue("release-v1");
    vi.mocked(getPromptBundle).mockResolvedValue({
      releaseId: "prompt-v2", blueprintId: "process-1", version: 2,
      systemPrompt: "Updated", instructions: [], guardrails: [], checksum: "checksum-v2", publishedAt: "now"
    });
  });

  it("moves one actor only after exact source and target confirmation", async () => {
    const { env, writes } = environment();
    const result = await migrateExecutionActorRelease(env, "tenant-1", "owner-1", "execution-1", {
      targetReleaseId: "release-v2", confirmFromReleaseId: "release-v1",
      reason: "Adopt the evaluated support policy."
    });
    expect(result).toMatchObject({ changed: true, fromReleaseId: "release-v1", toReleaseId: "release-v2" });
    expect(agent.migratePromptBundle).toHaveBeenCalledWith(expect.objectContaining({ releaseId: "prompt-v2" }),
      "tenant-1", "release-v1", "release-v2");
    expect(writes.some(({ sql, bindings }) => sql.includes("INSERT INTO actor_release_migrations") &&
      bindings.includes("release-v1") && bindings.includes("release-v2"))).toBe(true);
  });

  it("fails stale confirmation without changing actor state", async () => {
    const { env, writes } = environment();
    await expect(migrateExecutionActorRelease(env, "tenant-1", "owner-1", "execution-1", {
      targetReleaseId: "release-v2", confirmFromReleaseId: "release-stale",
      reason: "Adopt the evaluated support policy."
    })).rejects.toThrow("changed");
    expect(agent.migratePromptBundle).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
