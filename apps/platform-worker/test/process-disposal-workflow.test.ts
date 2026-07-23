import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/retirement", () => ({
  loadDisposalBatch: vi.fn(),
  eraseDisposalBatch: vi.fn(),
  recordDisposalProgress: vi.fn(),
  finalizeProcessDisposal: vi.fn(),
  failProcessDisposal: vi.fn()
}));
import { eraseDisposalBatch, failProcessDisposal, finalizeProcessDisposal,
  loadDisposalBatch, recordDisposalProgress } from "../src/retirement";
import { ProcessDisposalWorkflow } from "../src/process-disposal-workflow";

const step = { async do<T>(_name: string, optionsOrCallback: unknown, maybeCallback?: () => Promise<T>) {
  const callback = typeof optionsOrCallback === "function" ? optionsOrCallback as () => Promise<T> : maybeCallback!;
  return callback();
} };

describe("process disposal Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadDisposalBatch)
      .mockResolvedValueOnce(["process-1:thread:a", "process-1:thread:b"])
      .mockResolvedValueOnce([]);
    vi.mocked(eraseDisposalBatch).mockResolvedValue({
      durableActors: 2, conversationTurns: 8, agentPromptBundles: 2
    });
    vi.mocked(recordDisposalProgress).mockResolvedValue({
      durableActors: 2, conversationTurns: 8, agentPromptBundles: 2
    });
    vi.mocked(finalizeProcessDisposal).mockResolvedValue({
      durableActors: 2, conversationTurns: 8, agentPromptBundles: 2,
      executionPayloads: true, approvalContent: true, promptContent: false,
      auditRetained: true, disposedAt: "now"
    });
  });

  it("erases cursor batches, checkpoints counts, and finalizes retained evidence", async () => {
    const workflow = new ProcessDisposalWorkflow() as ProcessDisposalWorkflow & { env: unknown };
    workflow.env = { DB: {} };
    const result = await workflow.run({ instanceId: "job-1", payload: {
      tenantId: "tenant-1", retirementId: "retirement-1"
    } } as never, step as never);
    expect(eraseDisposalBatch).toHaveBeenCalledWith(expect.anything(), "tenant-1", "retirement-1",
      ["process-1:thread:a", "process-1:thread:b"]);
    expect(recordDisposalProgress).toHaveBeenCalledWith(expect.anything(), "tenant-1", "retirement-1",
      "process-1:thread:b", { durableActors: 2, conversationTurns: 8, agentPromptBundles: 2 });
    expect(finalizeProcessDisposal).toHaveBeenCalledWith(expect.anything(), "tenant-1", "retirement-1",
      { durableActors: 2, conversationTurns: 8, agentPromptBundles: 2 });
    expect(failProcessDisposal).not.toHaveBeenCalled();
    expect(result).toMatchObject({ retirementId: "retirement-1", durableActors: 2, auditRetained: true });
  });

  it("records terminal Workflow failure evidence", async () => {
    vi.mocked(loadDisposalBatch).mockReset().mockRejectedValue(new Error("D1 unavailable"));
    const workflow = new ProcessDisposalWorkflow() as ProcessDisposalWorkflow & { env: unknown };
    workflow.env = { DB: {} };
    await expect(workflow.run({ instanceId: "job-2", payload: {
      tenantId: "tenant-1", retirementId: "retirement-2"
    } } as never, step as never)).rejects.toThrow("D1 unavailable");
    expect(failProcessDisposal).toHaveBeenCalledWith(expect.anything(), "tenant-1", "retirement-2",
      expect.any(Error));
  });
});
