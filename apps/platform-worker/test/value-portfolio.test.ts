import { describe, expect, it } from "vitest";
import { classifyPortfolioDecision, getValueDashboard } from "../src/discovery";

const baseline = {
  itemsProcessed: 100, estimatedValue: 2000, overrideCount: 2, adverseRuns: 2, runs: 100,
  openIncidents: 0, safetyCap: null, opportunityScore: 75, status: "active", operatingMode: "normal"
  , targetConfigured: true
};

describe("executive value portfolio", () => {
  it("recommends correction before expansion when governed safety evidence is open", () => {
    expect(classifyPortfolioDecision({ ...baseline, openIncidents: 1 }).action).toBe("correct");
    expect(classifyPortfolioDecision({ ...baseline, safetyCap: "suggest" }).action).toBe("correct");
    expect(classifyPortfolioDecision({ ...baseline, adverseRuns: 11 }).action).toBe("correct");
    expect(classifyPortfolioDecision({ ...baseline, overrideCount: 16 }).action).toBe("correct");
  });

  it("requires evidence for expansion and never treats sparse activity as success", () => {
    expect(classifyPortfolioDecision(baseline)).toMatchObject({ action: "expand", confidence: "high" });
    expect(classifyPortfolioDecision({ ...baseline, itemsProcessed: 2, runs: 2 }).action).toBe("observe");
    expect(classifyPortfolioDecision({ ...baseline, targetConfigured: false })).toMatchObject({
      action: "observe", reason: "No approved 30-day value target is configured"
    });
  });

  it("reserves retirement for paused, low-opportunity work with no measured value", () => {
    expect(classifyPortfolioDecision({ ...baseline, itemsProcessed: 20, runs: 20, estimatedValue: 0,
      opportunityScore: 30, status: "paused", operatingMode: "paused" })).toMatchObject({
      action: "retire", confidence: "medium"
    });
    expect(classifyPortfolioDecision({ ...baseline, estimatedValue: 0 })).toMatchObject({ action: "hold" });
  });

  it("scopes every portfolio query to the authenticated tenant", async () => {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const DB = { prepare(sql: string) {
      const call = { sql, bindings: [] as unknown[] }; calls.push(call);
      const statement = {
        bind(...bindings: unknown[]) { call.bindings = bindings; return statement; },
        async first() { return { items_processed: 0, human_minutes_saved: 0, estimated_value: 0, override_count: 0, failure_count: 0 }; },
        async all() { return { results: [] }; }
      };
      return statement;
    } };
    const result = await getValueDashboard({ DB } as never, "tenant-private");
    expect(result.portfolio).toEqual([]);
    expect(calls).toHaveLength(5);
    expect(calls.every((call) => call.bindings.length > 0 && call.bindings.every((value) => value === "tenant-private"))).toBe(true);
    expect(calls.every((call) => call.sql.includes("tenant_id"))).toBe(true);
  });
});
