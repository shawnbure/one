import { describe, expect, it } from "vitest";
import { listApiLogs } from "../src/api-logs";

type Call = { sql: string; bindings: unknown[] };

function environment(rows: Array<Record<string, unknown>> = []) {
  const calls: Call[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; calls.push({ sql, bindings }); return statement; },
        async all() { return { results: rows }; },
        async first() { return { total: 125, average_latency_ms: 18.6, errors: 7 }; }
      };
      return statement;
    }
  };
  return { env: { DB } as never, calls };
}

describe("API log pagination", () => {
  it("returns a stable cursor and tenant-scoped filtered summary", async () => {
    const state = environment([
      { id: "log-3", created_at: "2026-07-23 12:00:03" },
      { id: "log-2", created_at: "2026-07-23 12:00:02" },
      { id: "log-1", created_at: "2026-07-23 12:00:01" }
    ]);
    const result = await listApiLogs(state.env, "tenant-1", {
      direction: "outbound", outcome: "error", search: "graph_100%", limit: "2"
    });
    expect(result).toMatchObject({
      data: [{ id: "log-3" }, { id: "log-2" }],
      page: { limit: 2, hasMore: true },
      summary: { total: 125, averageLatencyMs: 19, errors: 7 }
    });
    expect(result.page.nextCursor).toEqual(expect.any(String));
    expect(state.calls).toHaveLength(2);
    expect(state.calls.every((call) => call.bindings[0] === "tenant-1")).toBe(true);
    expect(state.calls[0]!.sql).toContain("ORDER BY created_at DESC, id DESC");
    expect(state.calls[0]!.bindings).toContain("%graph\\_100\\%%");
    expect(state.calls[1]!.sql).not.toContain("created_at<?");

    const next = environment([]);
    await listApiLogs(next.env, "tenant-1", { cursor: result.page.nextCursor!, limit: "2" });
    expect(next.calls[0]!.sql).toContain("(created_at<? OR (created_at=? AND id<?))");
    expect(next.calls[0]!.bindings).toEqual([
      "tenant-1", "2026-07-23 12:00:02", "2026-07-23 12:00:02", "log-2", 3
    ]);
  });

  it("rejects unbounded or unsupported query input", async () => {
    const state = environment();
    await expect(listApiLogs(state.env, "tenant-1", { direction: "sideways" }))
      .rejects.toThrow("direction");
    await expect(listApiLogs(state.env, "tenant-1", { outcome: "maybe" }))
      .rejects.toThrow("outcome");
    await expect(listApiLogs(state.env, "tenant-1", { limit: "1000" }))
      .rejects.toThrow("page size");
    await expect(listApiLogs(state.env, "tenant-1", { cursor: "not-a-valid-cursor" }))
      .rejects.toThrow("cursor");
  });
});
