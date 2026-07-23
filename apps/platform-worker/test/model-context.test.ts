import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateText, workersModel, createWorkersAI } = vi.hoisted(() => ({
  generateText: vi.fn(), workersModel: vi.fn(), createWorkersAI: vi.fn()
}));
vi.mock("ai", () => ({
  generateText,
  stepCountIs: vi.fn((count: number) => ({ count }))
}));
vi.mock("workers-ai-provider", () => ({
  createWorkersAI
}));
vi.mock("workers-ai-provider/openai", () => ({ openai: { wireFormat: "openai" } }));

import { runModel } from "../src/model";

const prompt = {
  releaseId: "release-1", blueprintId: "process-1", version: 1,
  systemPrompt: "Operate safely.", instructions: ["Be concise."], guardrails: ["Do not invent."],
  tools: [], checksum: "checksum"
};

describe("model conversation context", () => {
  beforeEach(() => {
    generateText.mockReset();
    workersModel.mockReset();
    createWorkersAI.mockReset();
    createWorkersAI.mockReturnValue(workersModel);
    workersModel.mockImplementation((modelId: string) => ({ modelId }));
    generateText.mockResolvedValue({
      text: "Done", usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
    });
  });

  it("sends bounded actor history before the current turn", async () => {
    await runModel({ AI: {} } as never, "balanced", prompt, "current request", "actor-affinity", undefined, [
      { role: "user", content: "earlier request" },
      { role: "assistant", content: "earlier response" }
    ]);
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: "user", content: "earlier request" },
        { role: "assistant", content: "earlier response" },
        { role: "user", content: "current request" }
      ]
    }));
    expect(generateText.mock.calls[0][0]).not.toHaveProperty("prompt");
  });

  it("keeps instant runs on a single prompt without synthetic history", async () => {
    await runModel({ AI: {} } as never, "fast", prompt, "one-off request");
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: "one-off request" }));
    expect(generateText.mock.calls[0][0]).not.toHaveProperty("messages");
  });

  it("uses the exact allowlisted model pinned by the published release", async () => {
    const pinned = "@cf/meta/llama-3.1-8b-instruct-fp8";
    const result = await runModel({ AI: {} } as never, "balanced", prompt, "release request",
      undefined, undefined, [], pinned);
    expect(workersModel).toHaveBeenCalledWith(pinned, {});
    expect(result.model).toBe(pinned);
  });

  it("routes an approved external model through the tenant gateway without response caching", async () => {
    const env = {
      AI: {},
      DB: { prepare(sql: string) { return {
        bind() { return this; },
        async first() {
          if (sql.includes("external_model_allowed")) return { external_model_allowed: 1 };
          return { gateway_id: "customer-ai", enabled: 1, collect_logs: 0,
            evidence_reference: "privacy-review-42", updated_by: "owner-1", updated_at: "2026-07-23" };
        }
      }; } }
    };
    const result = await runModel(env as never, "balanced", prompt, "gateway request", undefined, {
      tenantId: "tenant-1", executionId: "execution-1", autonomy: "suggest", policies: [],
      dataClassification: "internal"
    }, [], "openai/gpt-4.1-mini");
    expect(createWorkersAI).toHaveBeenCalledWith(expect.objectContaining({
      gateway: expect.objectContaining({ id: "customer-ai", skipCache: true, collectLog: false }),
      providers: [{ wireFormat: "openai" }]
    }));
    expect(workersModel).toHaveBeenCalledWith("openai/gpt-4.1-mini",
      expect.objectContaining({ resume: false }));
    expect(result).toMatchObject({
      model: "openai/gpt-4.1-mini", inferenceProvider: "ai_gateway", gatewayId: "customer-ai"
    });
  });

  it("fails closed when release evidence references an unsupported model", async () => {
    await expect(runModel({ AI: {} } as never, "balanced", prompt, "release request",
      undefined, undefined, [], "@cf/unreviewed/model")).rejects.toThrow("unsupported inference model");
    expect(generateText).not.toHaveBeenCalled();
  });
});
