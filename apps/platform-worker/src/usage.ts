import type { Env } from "./types";

export async function assertBudgetAvailable(env: Env, tenantId: string) {
  const budget = await env.DB.prepare(`SELECT monthly_limit_usd,
    ((SELECT COALESCE(SUM(estimated_cost_usd),0) FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month')) +
     (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM evaluation_case_results WHERE tenant_id = ? AND created_at >= date('now','start of month'))) spent
    FROM tenant_budgets WHERE tenant_id = ? AND hard_limit = 1`).bind(tenantId, tenantId, tenantId).first<{ monthly_limit_usd: number; spent: number }>();
  if (budget && Number(budget.spent) >= Number(budget.monthly_limit_usd)) throw new Error("Monthly AI budget hard limit has been reached");
}

export async function getUsageLedger(env: Env, tenantId: string) {
  const [summary, budget, models, byModel, byProcess, recent] = await Promise.all([
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month')) executions,
      (SELECT COUNT(*) FROM evaluation_case_results WHERE tenant_id = ? AND created_at >= date('now','start of month')) evaluation_cases,
      (SELECT COALESCE(SUM(input_tokens),0) FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month')) +
        (SELECT COALESCE(SUM(input_tokens),0) FROM evaluation_case_results WHERE tenant_id = ? AND created_at >= date('now','start of month')) input_tokens,
      (SELECT COALESCE(SUM(output_tokens),0) FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month')) +
        (SELECT COALESCE(SUM(output_tokens),0) FROM evaluation_case_results WHERE tenant_id = ? AND created_at >= date('now','start of month')) output_tokens,
      (SELECT COALESCE(SUM(total_tokens),0) FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month')) +
        (SELECT COALESCE(SUM(total_tokens),0) FROM evaluation_case_results WHERE tenant_id = ? AND created_at >= date('now','start of month')) total_tokens,
      (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month')) +
        (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM evaluation_case_results WHERE tenant_id = ? AND created_at >= date('now','start of month')) estimated_cost_usd`)
      .bind(tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId).first(),
    env.DB.prepare("SELECT * FROM tenant_budgets WHERE tenant_id = ?").bind(tenantId).first(),
    env.DB.prepare("SELECT * FROM model_catalog ORDER BY input_usd_per_million").all(),
    env.DB.prepare(`SELECT model, SUM(executions) executions, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens,
      SUM(total_tokens) total_tokens, SUM(estimated_cost_usd) estimated_cost_usd FROM (
        SELECT model, COUNT(*) executions, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens, SUM(total_tokens) total_tokens,
          SUM(estimated_cost_usd) estimated_cost_usd FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month') AND model IS NOT NULL GROUP BY model
        UNION ALL
        SELECT model, COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(total_tokens), SUM(estimated_cost_usd)
          FROM evaluation_case_results WHERE tenant_id = ? AND created_at >= date('now','start of month') AND model IS NOT NULL GROUP BY model
      ) GROUP BY model ORDER BY estimated_cost_usd DESC`).bind(tenantId, tenantId).all(),
    env.DB.prepare(`SELECT blueprint_id, process_name, SUM(executions) executions, SUM(total_tokens) total_tokens,
      SUM(estimated_cost_usd) estimated_cost_usd FROM (
        SELECT e.blueprint_id, b.name process_name, COUNT(*) executions, SUM(e.total_tokens) total_tokens, SUM(e.estimated_cost_usd) estimated_cost_usd
          FROM executions e JOIN agent_blueprints b ON b.id = e.blueprint_id
          WHERE e.tenant_id = ? AND e.started_at >= date('now','start of month') GROUP BY e.blueprint_id, b.name
        UNION ALL
        SELECT r.blueprint_id, b.name, COUNT(*), SUM(c.total_tokens), SUM(c.estimated_cost_usd)
          FROM evaluation_case_results c JOIN evaluation_runs r ON r.id = c.run_id
          JOIN agent_blueprints b ON b.id = r.blueprint_id
          WHERE c.tenant_id = ? AND c.created_at >= date('now','start of month') GROUP BY r.blueprint_id, b.name
      ) GROUP BY blueprint_id, process_name ORDER BY estimated_cost_usd DESC`).bind(tenantId, tenantId).all(),
    env.DB.prepare(`SELECT id, blueprint_id, model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, started_at
      FROM executions WHERE tenant_id = ? AND model IS NOT NULL ORDER BY started_at DESC LIMIT 50`).bind(tenantId).all()
  ]);
  return { summary, budget, models: models.results, byModel: byModel.results, byProcess: byProcess.results, recent: recent.results,
    estimateNotice: "Estimates use the model rate captured in Workrr and may differ from Cloudflare invoices, free allocations, cached input, or future pricing." };
}

export function pricedCompletionSql() {
  return `UPDATE executions SET status = 'completed', output_preview = ?, model = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?,
    estimated_cost_usd = ((? * COALESCE((SELECT input_usd_per_million FROM model_catalog WHERE model_id = ?),0)) +
      (? * COALESCE((SELECT output_usd_per_million FROM model_catalog WHERE model_id = ?),0))) / 1000000.0,
    completed_at = ? WHERE id = ?`;
}
