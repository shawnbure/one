import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorOperationalSnapshot } from "../src/agent";

const { actor, getAgentByName } = vi.hoisted(() => {
  const durableActor = {
    inspectOperationalHealth: vi.fn(),
  };
  return { actor: durableActor, getAgentByName: vi.fn(async () => durableActor) };
});
vi.mock("agents", () => ({ getAgentByName }));

import { classifyActorHealth, inspectExecutionActorHealth } from "../src/actor-health";

const snapshot: ActorOperationalSnapshot = {
  observedAt: "2026-07-23T12:00:00.000Z",
  bound: true,
  turnCount: 6,
  lastActiveAt: "2026-07-23T11:59:00.000Z",
  pinnedProcessReleaseId: "release-active",
  pinnedPromptReleaseId: "prompt-1",
  installedPromptBundles: 1,
  liveConnections: 0,
  memory: { active: 8, quarantined: 1, deleted: 0 },
  facts: { proposed: 1, active: 2, retired: 0, expiredActive: 0 },
  localWork: { queued: 0, scheduled: 1, running: 0, completed: 2, cancelled: 0, failed: 0 },
  sdkSchedules: 1,
};

function environment(profile = "conversation", instanceKey: string | null = "tenant/process/thread") {
  return {
    DB: {
      prepare(sql: string) {
        const statement = {
          bind(..._values: unknown[]) { return statement; },
          async first() {
            if (!sql.includes("FROM executions")) return null;
            return {
              blueprint_id: "process-1", execution_profile: profile, instance_key: instanceKey,
              process_release_id: "release-active", active_release_id: "release-active",
              active_version: 3, pinned_version: 3,
            };
          },
        };
        return statement;
      },
    },
    PROCESS_AGENT: {},
  } as never;
}

describe("durable actor operational health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actor.inspectOperationalHealth.mockResolvedValue(snapshot);
  });

  it("resolves only the tenant-scoped actor and returns content-free health evidence", async () => {
    const result = await inspectExecutionActorHealth(environment(), "tenant-1", "execution-1");
    expect(getAgentByName).toHaveBeenCalledWith({}, "tenant/process/thread");
    expect(result).toMatchObject({
      health: "healthy", releaseState: "current", storage: "durable_object_sqlite",
      compute: "ephemeral_worker_request", memory: { active: 8 }, liveConnections: 0,
    });
    expect(JSON.stringify(result)).not.toContain("tenant/process/thread");
  });

  it.each(["instant", "workflow"])("rejects the %s profile before waking a Durable Object", async (profile) => {
    await expect(inspectExecutionActorHealth(environment(profile, null), "tenant-1", "execution-1"))
      .rejects.toThrow("only available for durable");
    expect(getAgentByName).not.toHaveBeenCalled();
  });

  it("classifies release drift as attention and failed actor-local work as critical", () => {
    const drift = classifyActorHealth({
      execution_profile: "conversation", active_release_id: "release-new",
      active_version: 4, pinned_version: 3,
    }, snapshot);
    expect(drift.health).toBe("attention");
    expect(drift.releaseState).toBe("update_available");
    const failed = classifyActorHealth({
      execution_profile: "conversation", active_release_id: "release-active",
      active_version: 3, pinned_version: 3,
    }, { ...snapshot, localWork: { ...snapshot.localWork, failed: 1 } });
    expect(failed.health).toBe("critical");
    expect(failed.attention).toContain("1 actor-local task(s) failed.");
  });

  it("keeps an initialized but unused actor honest as awaiting evidence", () => {
    const result = classifyActorHealth({
      execution_profile: "conversation", active_release_id: "release-active",
      active_version: 3, pinned_version: 3,
    }, { ...snapshot, lastActiveAt: null });
    expect(result.health).toBe("awaiting_evidence");
  });
});
