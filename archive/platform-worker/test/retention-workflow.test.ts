import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/retention", () => ({
  markRetentionRunning: vi.fn(),
  loadRetentionActorBatch: vi.fn(),
  expireRetentionActorBatch: vi.fn(),
  recordRetentionProgress: vi.fn(),
  finalizeRetentionWorkflow: vi.fn(),
  failRetentionWorkflow: vi.fn(),
}));
import {
  expireRetentionActorBatch,
  failRetentionWorkflow,
  finalizeRetentionWorkflow,
  loadRetentionActorBatch,
  markRetentionRunning,
  recordRetentionProgress,
} from "../src/retention";
import { TenantRetentionWorkflow } from "../src/retention-workflow";

const step = {
  async do<T>(
    _name: string,
    optionsOrCallback: unknown,
    maybeCallback?: () => Promise<T>,
  ) {
    const callback =
      typeof optionsOrCallback === "function"
        ? (optionsOrCallback as () => Promise<T>)
        : maybeCallback!;
    return callback();
  },
};

describe("tenant retention Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markRetentionRunning).mockResolvedValue({ status: "running" });
    vi.mocked(loadRetentionActorBatch)
      .mockResolvedValueOnce([
        {
          instanceKey: "process-1:thread:a",
          blueprintId: "process-1",
          cursor: "a",
        },
        {
          instanceKey: "process-1:thread:b",
          blueprintId: "process-1",
          cursor: "b",
        },
      ])
      .mockResolvedValueOnce([]);
    vi.mocked(expireRetentionActorBatch).mockResolvedValue({
      durableActors: 2,
      conversationTurns: 8,
    });
    vi.mocked(recordRetentionProgress).mockResolvedValue({
      durableActors: 2,
      conversationTurns: 8,
    });
    vi.mocked(finalizeRetentionWorkflow).mockResolvedValue({
      durableActors: 2,
      conversationTurns: 8,
      auditRetained: true,
      enforcedAt: "now",
      executionContent: 3,
      approvalContent: 2,
      notificationContent: 1,
      helpRequestContent: 1,
      apiLogs: 4,
    });
  });

  it("expires cursor batches, checkpoints counts, and finalizes evidence", async () => {
    const workflow =
      new TenantRetentionWorkflow() as TenantRetentionWorkflow & {
        env: unknown;
      };
    workflow.env = { DB: {} };
    const result = await workflow.run(
      {
        instanceId: "run-1",
        payload: {
          tenantId: "tenant-1",
          runId: "run-1",
        },
      } as never,
      step as never,
    );
    expect(markRetentionRunning).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "run-1",
    );
    expect(recordRetentionProgress).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "run-1",
      "b",
      { durableActors: 2, conversationTurns: 8 },
    );
    expect(finalizeRetentionWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "run-1",
      { durableActors: 2, conversationTurns: 8 },
    );
    expect(failRetentionWorkflow).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      runId: "run-1",
      durableActors: 2,
      auditRetained: true,
    });
  });

  it("records a legal-hold or dependency interruption", async () => {
    vi.mocked(markRetentionRunning)
      .mockReset()
      .mockRejectedValue(new Error("protected by tenant legal hold"));
    const workflow =
      new TenantRetentionWorkflow() as TenantRetentionWorkflow & {
        env: unknown;
      };
    workflow.env = { DB: {} };
    await expect(
      workflow.run(
        {
          instanceId: "run-2",
          payload: {
            tenantId: "tenant-1",
            runId: "run-2",
          },
        } as never,
        step as never,
      ),
    ).rejects.toThrow("tenant legal hold");
    expect(failRetentionWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "run-2",
      expect.any(Error),
    );
  });
});
