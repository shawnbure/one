import { describe, expect, it } from "vitest";
import { classifyPortfolioDecision, getValueDashboard } from "../src/discovery";

const baseline = {
  itemsProcessed: 100, estimatedValue: 2000, overrideCount: 2, adverseRuns: 2, runs: 100,
  openIncidents: 0, safetyCap: null, opportunityScore: 75, status: "active", operatingMode: "normal"
  , targetConfigured: true, estimatedOperatingCost: 25
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
      estimatedOperatingCost: 0, opportunityScore: 30, status: "paused", operatingMode: "paused" })).toMatchObject({
      action: "retire", confidence: "medium"
    });
    expect(classifyPortfolioDecision({ ...baseline, estimatedValue: 0, estimatedOperatingCost: 0 }))
      .toMatchObject({ action: "hold" });
  });

  it("requires positive net value before recommending expansion", () => {
    expect(classifyPortfolioDecision({ ...baseline, estimatedValue: 20, estimatedOperatingCost: 25 }))
      .toMatchObject({
        action: "correct", confidence: "medium",
        reason: "$25.00 estimated AI cost exceeds or equals measured value"
      });
  });

  it("joins tenant-scoped execution cost and derives net economics", async () => {
    const DB = { prepare(sql: string) {
      const statement = {
        bind(..._bindings: unknown[]) { return statement; },
        async first() {
          return { items_processed: 100, human_minutes_saved: 600, estimated_value: 200,
            estimated_operating_cost: 12.5, override_count: 1, failure_count: 0 };
        },
        async all() {
          if (!sql.includes("runs_30d")) return { results: [] };
          return { results: [{
            blueprint_id: "process-1", process_name: "Intake", status: "active", operating_mode: "normal",
            business_owner: "Operations", department: "Operations", safety_autonomy_cap: null,
            baseline_volume: 100, baseline_minutes: 10, hourly_cost: 40, opportunity_score: 75,
            items_processed: 100, human_minutes_saved: 600, estimated_value: 200,
            override_count: 1, snapshot_failures: 0, runs: 100, completed_runs: 99,
            adverse_runs: 1, estimated_operating_cost: 12.5, avg_cycle_ms: 1000,
            open_incidents: 0, target_items: 100, target_human_minutes_saved: 600,
            target_value: 200, maximum_override_percent: 5, maximum_failure_percent: 5,
            target_review_due_at: new Date(Date.now() + 86_400_000).toISOString()
          }] };
        }
      };
      return statement;
    } };
    const result = await getValueDashboard({ DB } as never, "tenant-private");
    expect(result.totals).toMatchObject({ estimated_operating_cost: 12.5 });
    expect(result.portfolio[0]).toMatchObject({
      estimated_operating_cost: 12.5, netValue: 187.5, valueCostRatio: 16,
      recommendation: { action: "expand",
        reason: "100 items produced $187.50 net value with bounded exception rates" }
    });
  });

  it("scopes every portfolio query to the authenticated tenant", async () => {
    const calls: Array<{ sql: string; bindings: unknown[] }> = [];
    const DB = { prepare(sql: string) {
      const call = { sql, bindings: [] as unknown[] }; calls.push(call);
      const statement = {
        bind(...bindings: unknown[]) { call.bindings = bindings; return statement; },
        async first() { return { items_processed: 0, human_minutes_saved: 0, estimated_value: 0,
          estimated_operating_cost: 0, override_count: 0, failure_count: 0 }; },
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
