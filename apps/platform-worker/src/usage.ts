import type { Env } from "./types";

export async function assertBudgetAvailable(env: Env, tenantId: string) {
  const budget = await env.DB.prepare(`SELECT monthly_limit_usd,
    (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month')) spent
    FROM tenant_budgets WHERE tenant_id = ? AND hard_limit = 1`).bind(tenantId, tenantId).first<{ monthly_limit_usd: number; spent: number }>();
  if (budget && Number(budget.spent) >= Number(budget.monthly_limit_usd)) throw new Error("Monthly AI budget hard limit has been reached");
}

export async function getUsageLedger(env: Env, tenantId: string) {
  const [summary, budget, models, byModel, byProcess, recent] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) executions, COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(output_tokens),0) output_tokens,
      COALESCE(SUM(total_tokens),0) total_tokens, COALESCE(SUM(estimated_cost_usd),0) estimated_cost_usd
      FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month')`).bind(tenantId).first(),
    env.DB.prepare("SELECT * FROM tenant_budgets WHERE tenant_id = ?").bind(tenantId).first(),
    env.DB.prepare("SELECT * FROM model_catalog ORDER BY input_usd_per_million").all(),
    env.DB.prepare(`SELECT model, COUNT(*) executions, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens,
      SUM(total_tokens) total_tokens, SUM(estimated_cost_usd) estimated_cost_usd FROM executions
      WHERE tenant_id = ? AND started_at >= date('now','start of month') AND model IS NOT NULL GROUP BY model ORDER BY estimated_cost_usd DESC`).bind(tenantId).all(),
    env.DB.prepare(`SELECT e.blueprint_id, b.name process_name, COUNT(*) executions, SUM(e.total_tokens) total_tokens,
      SUM(e.estimated_cost_usd) estimated_cost_usd FROM executions e JOIN agent_blueprints b ON b.id = e.blueprint_id
      WHERE e.tenant_id = ? AND e.started_at >= date('now','start of month') GROUP BY e.blueprint_id, b.name ORDER BY estimated_cost_usd DESC`).bind(tenantId).all(),
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
