import { describe, expect, it } from "vitest";
import { assertBudgetAvailable, pricedCompletionSql } from "../src/usage";

function budgetEnvironment(row: { monthly_limit_usd: number; spent: number } | null) {
  return { DB: { prepare() { const statement = { bind() { return statement; }, async first() { return row; } }; return statement; } } };
}

describe("usage budget enforcement", () => {
  it("does not block when no hard-limit budget row is returned", async () => {
    await expect(assertBudgetAvailable(budgetEnvironment(null) as never, "tenant-1")).resolves.toBeUndefined();
  });

  it("blocks new inference when captured spend reaches the hard limit", async () => {
    await expect(assertBudgetAvailable(budgetEnvironment({ monthly_limit_usd: 25, spent: 25.01 }) as never, "tenant-1"))
      .rejects.toThrow("hard limit");
  });

  it("prices input and output independently from the captured model rate", () => {
    const sql = pricedCompletionSql();
    expect(sql).toContain("input_usd_per_million");
    expect(sql).toContain("output_usd_per_million");
    expect(sql).toContain("estimated_cost_usd");
  });
});
