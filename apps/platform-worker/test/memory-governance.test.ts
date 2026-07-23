import { describe, expect, it } from "vitest";
import { boundedConversationContext } from "../src/agent";
import { validateMemoryChange } from "../src/memory-governance";

function row(index: number, content: string) {
  return {
    id: `turn-${index}`, role: index % 2 ? "user" as const : "assistant" as const, content,
    source_execution_id: `execution-${index}`, status: "active" as const, revision: 1,
    last_reason: null, last_changed_by: null,
    created_at: `2026-07-23T10:${String(index).padStart(2, "0")}:00Z`,
    updated_at: `2026-07-23T10:${String(index).padStart(2, "0")}:00Z`
  };
}

describe("actor-local conversation context", () => {
  it("uses only a bounded set of recent turns and restores chronological order", () => {
    const newestFirst = [row(3, "third"), row(2, "second"), row(1, "first")];
    expect(boundedConversationContext(newestFirst, 2, 100)).toEqual([
      { role: "assistant", content: "second" },
      { role: "user", content: "third" }
    ]);
  });

  it("stops before exceeding the total context ceiling and bounds a single turn", () => {
    const result = boundedConversationContext([row(2, "b".repeat(10)), row(1, "a".repeat(10))], 20, 15);
    expect(result).toEqual([{ role: "assistant", content: "b".repeat(10) }]);
    expect(boundedConversationContext([row(1, "a".repeat(9_000))], 20, 24_000)[0].content).toHaveLength(8_000);
  });
});

describe("memory governance validation", () => {
  it("requires optimistic revision, a bounded reason, and corrected content", () => {
    expect(validateMemoryChange({
      action: "correct", expectedRevision: 2, content: "Correct operational context",
      reason: "Customer corrected the source record."
    })).toMatchObject({ action: "correct", expectedRevision: 2 });
    expect(() => validateMemoryChange({
      action: "correct", expectedRevision: 2, reason: "Missing content"
    })).toThrow("Corrected memory content");
    expect(() => validateMemoryChange({
      action: "delete", expectedRevision: 0, reason: "Privacy request"
    })).toThrow("expected memory revision");
  });
});
