import { describe, expect, it } from "vitest";
import { chunkText, expireKnowledgeSources, persistKnowledgeCitations } from "../src/knowledge";

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

  it("persists bounded tenant-scoped citation evidence", async () => {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const DB = {
      prepare(sql: string) {
        const call = { sql, bindings: [] as unknown[] };
        calls.push(call);
        return { bind(...bindings: unknown[]) { call.bindings = bindings; return this; } };
      },
      async batch(statements: unknown[]) { expect(statements).toHaveLength(5); }
    };
    await persistKnowledgeCitations({ DB } as never, "tenant-a", "execution-1",
      Array.from({ length: 8 }, (_, index) => ({
        sourceId: `source-${index}`, sourceName: `Source ${index}`, chunkId: `chunk-${index}`,
        score: .9, excerpt: "safe excerpt", provenance: "approved"
      })));
    expect(calls).toHaveLength(5);
    expect(calls.every((call) => call.bindings[1] === "tenant-a" && call.bindings[2] === "execution-1")).toBe(true);
    expect(calls.every((call) => call.sql.includes("ON CONFLICT(execution_id, ordinal)"))).toBe(true);
  });

  it("expires only retrieval-ready sources at the supplied review boundary", async () => {
    let sql = "";
    let boundary: unknown;
    const DB = { prepare(value: string) {
      sql = value;
      return { bind(value: unknown) { boundary = value; return this; }, async run() { return { meta: { changes: 2 } }; } };
    } };
    const now = new Date("2026-07-23T12:00:00.000Z");
    await expireKnowledgeSources({ DB } as never, now);
    expect(sql).toContain("status='ready'");
    expect(sql).toContain("expires_at <= ?");
    expect(boundary).toBe(now.toISOString());
  });
});
