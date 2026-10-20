import type { Env } from "./types";
import { emitNotification } from "./notifications";

interface BudgetCandidate {
  tenant_id: string;
  scope_type: "tenant" | "process";
  scope_id: string;
  scope_name: string;
  monthly_limit_usd: number;
  warning_percent: number;
  hard_limit: number;
  spent: number;
}

export async function emitBudgetThresholdAlerts(env: Env, now = new Date()) {
  const periodMonth = now.toISOString().slice(0, 7);
  const monthStart = `${periodMonth}-01T00:00:00.000Z`;
  const { results } = await env.DB.prepare(`WITH
    tenant_spend AS (
      SELECT tenant_id, SUM(cost) spent FROM (
        SELECT tenant_id, COALESCE(SUM(estimated_cost_usd),0) cost
          FROM executions WHERE started_at>=? GROUP BY tenant_id
        UNION ALL
        SELECT tenant_id, COALESCE(SUM(estimated_cost_usd),0)
          FROM evaluation_case_results WHERE created_at>=? GROUP BY tenant_id
      ) GROUP BY tenant_id
    ),
    process_spend AS (
      SELECT tenant_id, blueprint_id, SUM(cost) spent FROM (
        SELECT tenant_id, blueprint_id, COALESCE(SUM(estimated_cost_usd),0) cost
          FROM executions WHERE started_at>=? GROUP BY tenant_id, blueprint_id
        UNION ALL
        SELECT c.tenant_id, r.blueprint_id, COALESCE(SUM(c.estimated_cost_usd),0)
          FROM evaluation_case_results c JOIN evaluation_runs r ON r.id=c.run_id AND r.tenant_id=c.tenant_id
          WHERE c.created_at>=? GROUP BY c.tenant_id, r.blueprint_id
      ) GROUP BY tenant_id, blueprint_id
    )
    SELECT tb.tenant_id, 'tenant' scope_type, tb.tenant_id scope_id, t.name scope_name,
      tb.monthly_limit_usd, tb.warning_percent, tb.hard_limit, COALESCE(ts.spent,0) spent
      FROM tenant_budgets tb JOIN tenants t ON t.id=tb.tenant_id
      LEFT JOIN tenant_spend ts ON ts.tenant_id=tb.tenant_id
      WHERE COALESCE(ts.spent,0) >= tb.monthly_limit_usd * tb.warning_percent / 100.0
    UNION ALL
    SELECT pb.tenant_id, 'process', pb.blueprint_id, b.name,
      pb.monthly_limit_usd, pb.warning_percent, pb.hard_limit, COALESCE(ps.spent,0)
      FROM process_budgets pb
      JOIN agent_blueprints b ON b.id=pb.blueprint_id AND b.tenant_id=pb.tenant_id
      LEFT JOIN process_spend ps ON ps.tenant_id=pb.tenant_id AND ps.blueprint_id=pb.blueprint_id
      WHERE COALESCE(ps.spent,0) >= pb.monthly_limit_usd * pb.warning_percent / 100.0
    ORDER BY spent DESC LIMIT 100`)
    .bind(monthStart, monthStart, monthStart, monthStart).all<BudgetCandidate>();
  let emitted = 0;
  let deduplicated = 0;
  for (const candidate of results) {
    const stage = Number(candidate.hard_limit) && Number(candidate.spent) >= Number(candidate.monthly_limit_usd)
      ? "hard_limit" : "warning";
    const claim = await env.DB.prepare(`INSERT OR IGNORE INTO budget_threshold_alert_receipts
      (tenant_id, scope_type, scope_id, period_month, stage)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(candidate.tenant_id, candidate.scope_type, candidate.scope_id, periodMonth, stage).run();
    if (claim.meta.changes !== 1) { deduplicated += 1; continue; }
    try {
      const percentage = Math.round(Number(candidate.spent) / Number(candidate.monthly_limit_usd) * 1000) / 10;
      const ids = await emitNotification(env, candidate.tenant_id, {
        eventType: "usage.budget_threshold",
        title: stage === "hard_limit" ? "Monthly AI hard limit reached" : "Monthly AI budget warning",
        detail: `${candidate.scope_type === "tenant" ? "Organization" : "Process"} “${safeName(candidate.scope_name)}” is at ${percentage}% of its monthly AI allocation. ${stage === "hard_limit" ? "New model calls in this scope are blocked." : "Review usage and allocation before the hard boundary."}`,
        targetType: candidate.scope_type === "tenant" ? "tenant_budget" : "process_budget",
        targetId: candidate.scope_id
      });
      if (!ids.length) {
        await releaseClaim(env, candidate, periodMonth, stage);
        continue;
      }
      await env.DB.prepare(`UPDATE budget_threshold_alert_receipts SET notification_event_count=?
        WHERE tenant_id=? AND scope_type=? AND scope_id=? AND period_month=? AND stage=?`)
        .bind(ids.length, candidate.tenant_id, candidate.scope_type, candidate.scope_id, periodMonth, stage).run();
      emitted += ids.length;
    } catch (error) {
      await releaseClaim(env, candidate, periodMonth, stage);
      throw error;
    }
  }
  return { considered: results.length, emitted, deduplicated, periodMonth };
}

async function releaseClaim(env: Env, candidate: BudgetCandidate, periodMonth: string, stage: string) {
  await env.DB.prepare(`DELETE FROM budget_threshold_alert_receipts
    WHERE tenant_id=? AND scope_type=? AND scope_id=? AND period_month=? AND stage=?`)
    .bind(candidate.tenant_id, candidate.scope_type, candidate.scope_id, periodMonth, stage).run();
}

function safeName(value: string) {
  return String(value).replace(/[\r\n\t]/g, " ").slice(0, 100);
}
