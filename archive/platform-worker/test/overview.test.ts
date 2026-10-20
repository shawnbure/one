import { describe, expect, it } from "vitest";
import { getOverviewData } from "../src/overview";

function environment(options?: { noEvidence?: boolean }) {
  const bindings: unknown[][] = [];
  const DB = {
    prepare(sql: string) {
      const statement = {
        bind(...input: unknown[]) { bindings.push(input); return statement; },
        async first() {
          if (sql.includes("agent_blueprints")) return { count: 4 };
          if (sql.includes("approvals WHERE")) return { count: 2 };
          if (sql.includes("SUM(input_tokens)")) return { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
          if (sql.includes("WITH durations")) {
            return options?.noEvidence ? null : { p95_ms: 1450, sample_count: 10 };
          }
          if (sql.includes("evaluation_runs")) return { count: 3 };
          if (sql.includes("process_queue_jobs")) return options?.noEvidence
            ? { active: null, attention: null } : { active: 2, attention: 1 };
          return null;
        },
        async all() {
          if (sql.includes("GROUP BY status")) return { results: options?.noEvidence ? [] : [
            { status: "completed", count: 8 }, { status: "failed", count: 1 }, { status: "blocked", count: 1 }
          ] };
          if (sql.includes("GROUP BY blueprint_id")) return { results: [{ blueprint_id: "process-1", count: 10 }] };
          return { results: [] };
        }
      };
      return statement;
    }
  };
  return { env: { DB } as never, bindings };
}

describe("overview operational health", () => {
  it("derives tenant-scoped reliability, latency, durable work, and queue evidence", async () => {
    const state = environment();
    await expect(getOverviewData(state.env, "tenant-1")).resolves.toMatchObject({
      activeProcesses: 4,
      runs7d: 10,
      completed7d: 8,
      failed7d: 1,
      operationalHealth: {
        terminalRuns: 10,
        successRate: 80,
        p95ResponseMs: 1450,
        latencySamples: 10,
        activeDurableWork: 3,
        activeQueueJobs: 2,
        queueAttention: 1,
        status: "attention"
      }
    });
    expect(state.bindings.every((values) => values.length > 0 && values.every((value) => value === "tenant-1")))
      .toBe(true);
  });

  it("reports an honest unobserved state instead of invented health values", async () => {
    const state = environment({ noEvidence: true });
    await expect(getOverviewData(state.env, "tenant-1")).resolves.toMatchObject({
      runs7d: 0,
      operationalHealth: {
        terminalRuns: 0,
        successRate: null,
        p95ResponseMs: null,
        latencySamples: 0,
        activeQueueJobs: 0,
        queueAttention: 0,
        status: "unobserved"
      }
    });
  });
});
