import { beforeEach, describe, expect, it, vi } from "vitest";

const { agent, getAgentByName } = vi.hoisted(() => {
  const actor = {
    bindTenant: vi.fn(),
    listLocalWork: vi.fn(),
    queueLocalTask: vi.fn(),
    scheduleLocalFollowUp: vi.fn(),
    cancelLocalSchedule: vi.fn()
  };
  return { agent: actor, getAgentByName: vi.fn(async () => actor) };
});
vi.mock("agents", () => ({ getAgentByName }));

import { listActorLocalWork, queueActorLocalWork, scheduleActorLocalWork } from "../src/actor-local-work";

function env(profile = "conversation", instanceKey: string | null = "tenant/process/thread") {
  return {
    DB: {
      prepare(sql: string) {
        const statement = {
          bind(..._values: unknown[]) { return statement; },
          async first() {
            if (sql.includes("FROM executions")) {
              return { blueprint_id: "process-1", execution_profile: profile, instance_key: instanceKey };
            }
            return null;
          },
          async all() { return { results: [] }; },
          async run() { return { meta: { changes: 1 } }; }
        };
        return statement;
      },
      async batch(statements: Array<{ run(): Promise<unknown> }>) {
        return Promise.all(statements.map((statement) => statement.run()));
      }
    },
    PROCESS_AGENT: {}
  } as never;
}

describe("actor-local work boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agent.listLocalWork.mockResolvedValue({ tasks: [], schedules: [] });
    agent.queueLocalTask.mockResolvedValue({ taskId: "task-1", status: "queued" });
    agent.scheduleLocalFollowUp.mockResolvedValue({ taskId: "task-2", scheduleId: "schedule-1" });
  });

  it("resolves a durable actor only from the tenant-scoped execution", async () => {
    await expect(listActorLocalWork(env(), "tenant-1", "execution-1"))
      .resolves.toMatchObject({ available: true, executionProfile: "conversation" });
    expect(getAgentByName).toHaveBeenCalledWith({}, "tenant/process/thread");
    expect(agent.bindTenant).toHaveBeenCalledWith("tenant-1", "process-1");
  });

  it.each(["instant", "workflow"])("rejects the %s profile before resolving an actor", async (profile) => {
    await expect(listActorLocalWork(env(profile, null), "tenant-1", "execution-1"))
      .rejects.toThrow("only available for durable");
    expect(getAgentByName).not.toHaveBeenCalled();
  });

  it("validates labels and due-time bounds before creating local work", async () => {
    await expect(queueActorLocalWork(env(), "tenant-1", "execution-1", { label: "x" }))
      .rejects.toThrow("between 3 and 160");
    await expect(scheduleActorLocalWork(env(), "tenant-1", "execution-1", {
      label: "Review the response", dueAt: new Date(Date.now() + 1_000).toISOString()
    })).rejects.toThrow("between 10 seconds and 30 days");
    expect(agent.queueLocalTask).not.toHaveBeenCalled();
    expect(agent.scheduleLocalFollowUp).not.toHaveBeenCalled();
  });
});
