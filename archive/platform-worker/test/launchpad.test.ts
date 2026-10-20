import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLaunchpadThread, executeLaunchpadProcess, executeLaunchpadThread,
  getLaunchpadConversation, governConsumerExecutionRequest, setLaunchpadThreadArchived } from "../src/launchpad";
import { executeRequest } from "../src/execution";

const getConversation = vi.fn();
const bindTenant = vi.fn();

vi.mock("agents", () => ({
  getAgentByName: vi.fn(async () => ({ bindTenant, getConversation })),
}));
vi.mock("../src/execution", () => ({
  executeRequest: vi.fn(),
}));

import { getAgentByName } from "agents";

function envWith(options: {
  process?: Record<string, unknown> | null;
  thread?: Record<string, unknown> | null;
} = {}) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const process = options.process === undefined ? {
    id: "process-1",
    name: "Customer Operations",
    execution_profile: "conversation",
    status: "active",
    operating_mode: "active",
    active_release_id: "release-1",
    actor_identity_version: 2,
  } : options.process;
  const thread = options.thread === undefined ? {
    id: "thread-1",
    blueprint_id: "process-1",
    process_name: "Customer Operations",
    title: "Northstar renewal",
    status: "active",
    execution_profile: "conversation",
    process_status: "active",
    operating_mode: "active",
    active_release_id: "release-1",
    actor_identity_version: 2,
    last_execution_id: "execution-1",
    created_at: "2026-07-23T00:00:00Z",
    updated_at: "2026-07-23T00:00:00Z",
  } : options.thread;
  const DB = {
    prepare(sql: string) {
      const statement = {
        sql,
        values: [] as unknown[],
        bind(...values: unknown[]) {
          statement.values = values;
          statements.push({ sql, values });
          return statement;
        },
        async first() {
          if (sql.includes("FROM agent_blueprints WHERE")) return process;
          if (sql.includes("FROM process_threads t")) return thread;
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  return { env: { DB, PROCESS_AGENT: {} } as never, statements };
}

describe("launchpad threads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeRequest).mockResolvedValue({
      executionId: "execution-new",
      instanceKey: "process-1:thread:thread-1",
      profile: "conversation",
      status: "completed",
      output: "Prepared",
      startedAt: "2026-07-23T00:00:00Z",
    });
    getConversation.mockResolvedValue([
      { role: "assistant", content: "Prepared", created_at: "2026-07-23T00:00:00Z" },
    ]);
  });

  it("creates only active published conversation threads without storing content", async () => {
    const { env, statements } = envWith();
    const result = await createLaunchpadThread(env, "tenant-1", "member-1", "process-1", "  Renewal review  ");

    expect(result.title).toBe("Renewal review");
    const insert = statements.find((item) => item.sql.includes("INSERT INTO process_threads"));
    expect(insert?.values.slice(1)).toEqual(["tenant-1", "process-1", "member-1", "Renewal review"]);
    expect(insert?.sql).not.toContain("content");
  });

  it("rejects non-conversation profiles when creating a thread", async () => {
    const { env } = envWith({ process: {
      id: "process-1", name: "Triage", execution_profile: "instant", status: "active",
      operating_mode: "active", active_release_id: "release-1",
    } });
    await expect(createLaunchpadThread(env, "tenant-1", "member-1", "process-1"))
      .rejects.toThrow("Only conversation agents");
  });

  it("fails closed when a thread is not owned by the authenticated member", async () => {
    const { env } = envWith({ thread: null });
    await expect(getLaunchpadConversation(env, "tenant-1", "other-member", "thread-1"))
      .rejects.toThrow("Conversation was not found");
    expect(bindTenant).not.toHaveBeenCalled();
  });

  it("loads conversation content from the durable actor only after ownership validation", async () => {
    const { env } = envWith();
    const result = await getLaunchpadConversation(env, "tenant-1", "member-1", "thread-1");

    expect(bindTenant).toHaveBeenCalledWith("tenant-1", "process-1");
    expect(getAgentByName).toHaveBeenCalledWith(
      {},
      "v2:tenant:tenant-1:process-1:thread:thread-1",
    );
    expect(getConversation).toHaveBeenCalledWith(60);
    expect(result.messages[0]?.content).toBe("Prepared");
  });

  it("executes a member-owned active thread with its durable identity", async () => {
    const { env, statements } = envWith();
    await executeLaunchpadThread(env, "tenant-1", "member-1", "thread-1", "  Prepare the summary  ");

    expect(executeRequest).toHaveBeenCalledWith(env, "tenant-1", expect.objectContaining({
      blueprintId: "process-1",
      threadId: "thread-1",
      input: "Prepare the summary",
      metadata: { source: "launchpad", actorId: "member-1" },
    }));
    expect(statements.some((item) => item.sql.includes("UPDATE process_threads SET last_execution_id"))).toBe(true);
  });

  it("keeps archived threads readable but prevents new turns", async () => {
    const { env } = envWith({ thread: {
      id: "thread-1", blueprint_id: "process-1", process_name: "Customer Operations",
      title: "Old", status: "archived", last_execution_id: "execution-1",
      execution_profile: "conversation", process_status: "active", operating_mode: "active",
      active_release_id: "release-1",
      created_at: "", updated_at: "",
    } });
    await expect(executeLaunchpadThread(env, "tenant-1", "member-1", "thread-1", "Continue"))
      .rejects.toThrow("read-only");
    expect(executeRequest).not.toHaveBeenCalled();
  });

  it("does not reopen a thread when the process is no longer runnable", async () => {
    const { env } = envWith({ thread: {
      id: "thread-1", blueprint_id: "process-1", process_name: "Customer Operations",
      title: "Old", status: "archived", last_execution_id: "execution-1",
      execution_profile: "conversation", process_status: "paused", operating_mode: "paused",
      active_release_id: "release-1", created_at: "", updated_at: "",
    } });
    await expect(setLaunchpadThreadArchived(env, "tenant-1", "member-1", "thread-1", false))
      .rejects.toThrow("Process is not active");
  });

  it("derives consumer actor identity on the server", async () => {
    const { env } = envWith({ process: {
      id: "process-1", name: "Personal assistant", execution_profile: "consumer", status: "active",
      operating_mode: "active", active_release_id: "release-1",
    } });
    await executeLaunchpadProcess(env, "tenant-1", "member-1", "process-1", "My request");

    expect(executeRequest).toHaveBeenCalledWith(env, "tenant-1", expect.objectContaining({
      consumerId: "member-1",
      input: "My request",
    }));
  });

  it("prevents consumers from selecting another member's conversation identity", async () => {
    const { env } = envWith({ thread: null });
    await expect(governConsumerExecutionRequest(env, "tenant-1", "member-1", {
      blueprintId: "process-1",
      threadId: "someone-elses-thread",
      input: "Show me the prior context",
    })).rejects.toThrow("Conversation was not found");
  });

  it("overrides a forged consumer actor identity", async () => {
    const { env } = envWith({ process: {
      id: "process-1", name: "Personal assistant", execution_profile: "consumer", status: "active",
      operating_mode: "active", active_release_id: "release-1",
    } });
    const result = await governConsumerExecutionRequest(env, "tenant-1", "member-1", {
      blueprintId: "process-1",
      consumerId: "other-member",
      input: "My request",
    });
    expect(result.consumerId).toBe("member-1");
  });
});
