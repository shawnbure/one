import { describe, expect, it } from "vitest";
import { chunkText } from "../src/knowledge";

describe("knowledge chunking", () => {
  it("keeps chunks bounded with overlap for retrieval continuity", () => {
    const text = Array.from({ length: 80 }, (_, index) =>
      `Policy paragraph ${index}. Customers must receive an attributable answer before the case is closed.`).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(120);
    expect(chunks.every((chunk) => chunk.length <= 1200)).toBe(true);
    expect(chunks[0]).toContain("Policy paragraph 0");
    expect(chunks.at(-1)).toContain("Policy paragraph 79");
  });

  it("normalizes empty content and does not create empty vectors", () => {
    expect(chunkText(" \n\n\n ")).toEqual([]);
  });

  it("caps adversarially large input to the indexing safety limit", () => {
    const chunks = chunkText("a".repeat(500_000));
    expect(chunks).toHaveLength(120);
    expect(chunks.every((chunk) => chunk.length <= 1200)).toBe(true);
  });
});
