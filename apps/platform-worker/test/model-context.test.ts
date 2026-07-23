import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", () => ({
  generateText,
  stepCountIs: vi.fn((count: number) => ({ count }))
}));
vi.mock("workers-ai-provider", () => ({
  createWorkersAI: vi.fn(() => vi.fn(() => ({ modelId: "test-model" })))
}));

import { runModel } from "../src/model";

const prompt = {
  releaseId: "release-1", blueprintId: "process-1", version: 1,
  systemPrompt: "Operate safely.", instructions: ["Be concise."], guardrails: ["Do not invent."],
  tools: [], checksum: "checksum"
};

describe("model conversation context", () => {
  beforeEach(() => {
    generateText.mockReset();
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
});
