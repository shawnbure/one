import { describe, expect, it } from "vitest";
import { boundedConversationContext, boundedDurableFacts } from "../src/agent";
import { validateFactChange, validateFactProposal, validateMemoryChange } from "../src/memory-governance";

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

  it("requires provenance, bounded expiry, and a separate fact approval action", () => {
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect(validateFactProposal({
      category: "customer_context", content: "Customer uses fiscal quarters ending in March.",
      sourceTurnId: "turn-1", reason: "Confirmed in the cited customer turn.", expiresAt
    })).toMatchObject({ category: "customer_context", sourceTurnId: "turn-1" });
    expect(validateFactChange({
      action: "approve", expectedRevision: 1, reason: "Reviewed against the cited turn."
    })).toMatchObject({ action: "approve", expectedRevision: 1 });
    expect(() => validateFactProposal({
      category: "customer_context", content: "Fact", sourceTurnId: "",
      reason: "No source", expiresAt
    })).toThrow("source memory turn");
  });

  it("bounds approved durable fact context independently from conversation turns", () => {
    const fact = (index: number, content: string) => ({
      id: `fact-${index}`, category: "preference" as const, content, source_turn_id: `turn-${index}`,
      source_execution_id: `execution-${index}`, status: "active" as const, revision: 1,
      proposed_by: "operator-1", approved_by: "owner-1", reason: "Reviewed",
      expires_at: "2027-01-01T00:00:00.000Z", created_at: "2026-07-23T00:00:00.000Z",
      updated_at: `2026-07-23T00:00:0${index}.000Z`
    });
    expect(boundedDurableFacts([fact(1, "Use concise summaries"), fact(2, "Escalate contract changes")], 20, 100))
      .toEqual(["[preference] Use concise summaries", "[preference] Escalate contract changes"]);
    expect(boundedDurableFacts([fact(1, "x".repeat(600))], 20, 1_000)[0]).toHaveLength(513);
  });
});
