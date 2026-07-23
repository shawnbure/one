import { describe, expect, it } from "vitest";
import { analyzePromptBudget, assertPromptBudget } from "../src/prompt-budget";

describe("prompt release budgets", () => {
  it("separates static release content from the larger sticky runtime reserve", () => {
    const instant = analyzePromptBudget({
      systemPrompt: "a".repeat(4_000), instructions: ["b".repeat(2_000)],
      guardrails: ["never expose secrets"], contextTokens: 24_000, executionProfile: "instant"
    });
    const durable = analyzePromptBudget({
      systemPrompt: "a".repeat(4_000), instructions: ["b".repeat(2_000)],
      guardrails: ["never expose secrets"], contextTokens: 24_000, executionProfile: "conversation"
    });
    expect(instant.estimatedStaticTokens).toBe(durable.estimatedStaticTokens);
    expect(durable.reservedRuntimeTokens).toBeGreaterThan(instant.reservedRuntimeTokens);
    expect(durable.staticPromptBudgetTokens).toBeLessThan(instant.staticPromptBudgetTokens);
    expect(durable.sections.total.bytes).toBeGreaterThan(6_000);
  });

  it("warns at seventy percent and rejects a release that consumes runtime headroom", () => {
    const attention = analyzePromptBudget({
      systemPrompt: "x".repeat(24_000), instructions: [], guardrails: [],
      contextTokens: 24_000, executionProfile: "conversation"
    });
    expect(attention).toMatchObject({
      staticPromptBudgetTokens: 8_000, estimatedStaticTokens: 6_000, status: "attention"
    });
    expect(() => assertPromptBudget({
      systemPrompt: "x".repeat(36_000), instructions: [], guardrails: [],
      contextTokens: 24_000, executionProfile: "conversation"
    })).toThrow("exceeds this model");
  });

  it("fails closed when model context evidence is unavailable", () => {
    expect(() => analyzePromptBudget({
      systemPrompt: "safe", instructions: [], guardrails: [],
      contextTokens: 0, executionProfile: "instant"
    })).toThrow("context budget is unavailable");
  });
});
