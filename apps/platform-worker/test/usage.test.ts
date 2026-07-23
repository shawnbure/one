import { describe, expect, it } from "vitest";
import { assertBudgetAvailable, importBillingEvidence, pricedCompletionSql, updateProcessBudget, voidBillingEvidence } from "../src/usage";

function budgetEnvironment(row: { monthly_limit_usd: number; spent: number } | null, sqls: string[] = []) {
  return { DB: { prepare(sql: string) { sqls.push(sql); const statement = { bind() { return statement; }, async first() { return row; } }; return statement; } } };
}

describe("usage budget enforcement", () => {
  it("does not block when no hard-limit budget row is returned", async () => {
    await expect(assertBudgetAvailable(budgetEnvironment(null) as never, "tenant-1")).resolves.toBeUndefined();
  });

  it("blocks new inference when captured spend reaches the hard limit", async () => {
    await expect(assertBudgetAvailable(budgetEnvironment({ monthly_limit_usd: 25, spent: 25.01 }) as never, "tenant-1"))
      .rejects.toThrow("hard limit");
  });

  it("includes evaluation inference in hard-limit spend", async () => {
    const sqls: string[] = [];
    await assertBudgetAvailable(budgetEnvironment(null, sqls) as never, "tenant-1");
    expect(sqls[0]).toContain("evaluation_case_results");
  });

  it("enforces a tenant-scoped process allocation after the organization budget", async () => {
    const sqls: string[] = [];
    const env = { DB: { prepare(sql: string) {
      sqls.push(sql);
      const statement = {
        bind(...bindings: unknown[]) {
          expect(bindings).not.toContain("tenant-2");
          return statement;
        },
        async first() {
          return sql.includes("FROM process_budgets") ? { monthly_limit_usd: 5, spent: 5.2 } : null;
        }
      };
      return statement;
    } } };
    await expect(assertBudgetAvailable(env as never, "tenant-1", "process-1"))
      .rejects.toThrow("This process has reached");
    expect(sqls[1]).toContain("r.blueprint_id");
    expect(sqls[1]).toContain("blueprint_id=?");
  });

  it("prices input and output independently from the captured model rate", () => {
    const sql = pricedCompletionSql();
    expect(sql).toContain("input_usd_per_million");
    expect(sql).toContain("output_usd_per_million");
    expect(sql).toContain("estimated_cost_usd");
    expect(sql).toContain("model_latency_ms");
  });
});

describe("process budget policy", () => {
  function environment(processExists = true) {
    const writes: Array<{ sql: string; bindings: unknown[] }> = [];
    const DB = { prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() { return sql.includes("FROM agent_blueprints") && processExists ? { id: "process-1" } : null; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    } };
    return { env: { DB } as never, writes };
  }

  it("writes and removes only the same-tenant process policy with bounded values", async () => {
    const state = environment();
    await expect(updateProcessBudget(state.env, "tenant-1", "owner-1", "process-1", {
      enabled: true, monthlyLimitUsd: 5, warningPercent: 75, hardLimit: true
    })).resolves.toMatchObject({ enabled: true, hardLimit: true });
    expect(state.writes.some(({ sql, bindings }) =>
      sql.includes("INSERT INTO process_budgets") && bindings[0] === "tenant-1" && bindings[1] === "process-1")).toBe(true);
    await expect(updateProcessBudget(state.env, "tenant-1", "owner-1", "process-1", {
      enabled: false
    })).resolves.toMatchObject({ enabled: false });
    expect(state.writes.some(({ sql }) => sql.includes("DELETE FROM process_budgets"))).toBe(true);
    await expect(updateProcessBudget(environment(false).env, "tenant-1", "owner-1", "process-2", {
      enabled: true, monthlyLimitUsd: 5, warningPercent: 75, hardLimit: true
    })).rejects.toThrow("Process not found");
  });
});

function reconciliationEnvironment(options?: { existing?: { id: string; status: string }; changes?: number }) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("estimated")) return { estimated: 8 };
          if (sql.includes("WHERE tenant_id=? AND checksum=?")) return options?.existing ?? null;
          return null;
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: options?.changes ?? 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: { DB } as never, writes };
}

describe("Cloudflare billing reconciliation", () => {
  const evidence = {
    periodStart: "2026-07-01", periodEnd: "2026-07-22", source: "cloudflare_dashboard",
    sourceReference: "dashboard-july-2026", workersAiNeurons: 1_000_000,
    workersAiCostUsd: 10, platformCostUsd: 18, workersRequests: 25_000
  };

  it("normalizes evidence and records estimate variance without storing an invoice payload", async () => {
    const state = reconciliationEnvironment();
    await expect(importBillingEvidence(state.env, "tenant-1", "owner-1", evidence))
      .resolves.toMatchObject({ imported: true, estimated: 8, billed: 10, variance: 2, variancePercent: 25 });
    const insert = state.writes.find(({ sql }) => sql.includes("INSERT INTO billing_reconciliations"));
    expect(insert).toBeDefined();
    expect(JSON.stringify(state.writes)).not.toContain("invoice_file");
    expect(JSON.stringify(state.writes)).toContain("billing.reconciliation_imported");
  });

  it("is checksum-idempotent and validates period and numeric boundaries", async () => {
    const duplicate = reconciliationEnvironment({ existing: { id: "billing-1", status: "active" } });
    await expect(importBillingEvidence(duplicate.env, "tenant-1", "owner-1", evidence))
      .resolves.toEqual({ id: "billing-1", status: "active", imported: false });
    expect(duplicate.writes).toHaveLength(0);
    await expect(importBillingEvidence(reconciliationEnvironment().env, "tenant-1", "owner-1",
      { ...evidence, periodEnd: "2027-01-01" })).rejects.toThrow("future");
    await expect(importBillingEvidence(reconciliationEnvironment().env, "tenant-1", "owner-1",
      { ...evidence, workersAiCostUsd: -1 })).rejects.toThrow("Workers AI cost");
  });

  it("voids rather than deletes correction evidence and requires a reason", async () => {
    const state = reconciliationEnvironment();
    await expect(voidBillingEvidence(state.env, "tenant-1", "owner-1", "billing-1",
      "Invoice was superseded by the final statement.")).resolves.toEqual({ id: "billing-1", status: "voided" });
    expect(state.writes.some(({ sql }) => sql.includes("status='voided'"))).toBe(true);
    expect(state.writes.some(({ sql }) => sql.includes("DELETE FROM billing_reconciliations"))).toBe(false);
    await expect(voidBillingEvidence(reconciliationEnvironment().env, "tenant-1", "owner-1",
      "billing-1", "short")).rejects.toThrow("10–500");
  });
});
