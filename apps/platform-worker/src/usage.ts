import type { Env } from "./types";

export async function assertBudgetAvailable(env: Env, tenantId: string, blueprintId?: string) {
  const budget = await env.DB.prepare(`SELECT monthly_limit_usd,
    ((SELECT COALESCE(SUM(estimated_cost_usd),0) FROM executions WHERE tenant_id = ? AND started_at >= date('now','start of month')) +
     (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM evaluation_case_results WHERE tenant_id = ? AND created_at >= date('now','start of month'))) spent
    FROM tenant_budgets WHERE tenant_id = ? AND hard_limit = 1`).bind(tenantId, tenantId, tenantId).first<{ monthly_limit_usd: number; spent: number }>();
  if (budget && Number(budget.spent) >= Number(budget.monthly_limit_usd)) throw new Error("Monthly AI budget hard limit has been reached");
  if (!blueprintId) return;
  const processBudget = await env.DB.prepare(`SELECT monthly_limit_usd,
    ((SELECT COALESCE(SUM(estimated_cost_usd),0) FROM executions
      WHERE tenant_id=? AND blueprint_id=? AND started_at >= date('now','start of month')) +
     (SELECT COALESCE(SUM(c.estimated_cost_usd),0) FROM evaluation_case_results c
      JOIN evaluation_runs r ON r.id=c.run_id AND r.tenant_id=c.tenant_id
      WHERE c.tenant_id=? AND r.blueprint_id=? AND c.created_at >= date('now','start of month'))) spent
    FROM process_budgets WHERE tenant_id=? AND blueprint_id=? AND hard_limit=1`)
    .bind(tenantId, blueprintId, tenantId, blueprintId, tenantId, blueprintId)
    .first<{ monthly_limit_usd: number; spent: number }>();
  if (processBudget && Number(processBudget.spent) >= Number(processBudget.monthly_limit_usd)) {
    throw new Error("This process has reached its monthly AI budget hard limit");
  }
}

export async function getUsageLedger(env: Env, tenantId: string) {
  const [summary, budget, models, byModel, byProcess, recent, reconciliations] = await Promise.all([
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
    env.DB.prepare(`WITH usage AS (
        SELECT blueprint_id, SUM(executions) executions, SUM(total_tokens) total_tokens,
          SUM(estimated_cost_usd) estimated_cost_usd FROM (
          SELECT e.blueprint_id, COUNT(*) executions, SUM(e.total_tokens) total_tokens,
            SUM(e.estimated_cost_usd) estimated_cost_usd
            FROM executions e WHERE e.tenant_id=? AND e.started_at >= date('now','start of month')
            GROUP BY e.blueprint_id
          UNION ALL
          SELECT r.blueprint_id, COUNT(*), SUM(c.total_tokens), SUM(c.estimated_cost_usd)
            FROM evaluation_case_results c JOIN evaluation_runs r ON r.id=c.run_id
            WHERE c.tenant_id=? AND c.created_at >= date('now','start of month')
            GROUP BY r.blueprint_id
        ) GROUP BY blueprint_id
      )
      SELECT b.id blueprint_id, b.name process_name, COALESCE(usage.executions,0) executions,
      COALESCE(usage.total_tokens,0) total_tokens, COALESCE(usage.estimated_cost_usd,0) estimated_cost_usd,
      pb.monthly_limit_usd, pb.warning_percent, pb.hard_limit
      FROM agent_blueprints b
      LEFT JOIN usage ON usage.blueprint_id=b.id
      LEFT JOIN process_budgets pb ON pb.tenant_id=b.tenant_id AND pb.blueprint_id=b.id
      WHERE b.tenant_id=?
      ORDER BY estimated_cost_usd DESC, b.name`).bind(tenantId, tenantId, tenantId).all(),
    env.DB.prepare(`SELECT id, blueprint_id, model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, started_at
      FROM executions WHERE tenant_id = ? AND model IS NOT NULL ORDER BY started_at DESC LIMIT 50`).bind(tenantId).all(),
    env.DB.prepare(`SELECT id, period_start, period_end, source, source_reference, workers_ai_neurons,
      workers_ai_cost_usd, platform_cost_usd, workers_requests, d1_rows_read, d1_rows_written,
      queue_operations, workflow_wall_time_ms, workrr_estimated_ai_cost_usd, variance_usd,
      variance_percent, status, imported_by, imported_at, voided_by, voided_at, void_reason
      FROM billing_reconciliations WHERE tenant_id=? ORDER BY period_end DESC, imported_at DESC LIMIT 24`)
      .bind(tenantId).all()
  ]);
  return { summary, budget, models: models.results, byModel: byModel.results, byProcess: byProcess.results, recent: recent.results,
    reconciliations: reconciliations.results,
    estimateNotice: "Estimates use the model rate captured in Workrr and may differ from Cloudflare invoices, free allocations, cached input, or future pricing." };
}

export async function updateProcessBudget(env: Env, tenantId: string, actorId: string, blueprintId: string, input: {
  monthlyLimitUsd?: number; warningPercent?: number; hardLimit?: boolean; enabled?: boolean;
}) {
  const process = await env.DB.prepare("SELECT id FROM agent_blueprints WHERE id=? AND tenant_id=?")
    .bind(blueprintId, tenantId).first();
  if (!process) throw new Error("Process not found");
  if (input.enabled === false) {
    await env.DB.prepare("DELETE FROM process_budgets WHERE tenant_id=? AND blueprint_id=?")
      .bind(tenantId, blueprintId).run();
    return { blueprintId, enabled: false };
  }
  const monthlyLimitUsd = Number(input.monthlyLimitUsd);
  const warningPercent = Number(input.warningPercent);
  if (!Number.isFinite(monthlyLimitUsd) || monthlyLimitUsd < 0.01 || monthlyLimitUsd > 1_000_000) {
    throw new Error("Process monthly budget must be between $0.01 and $1,000,000");
  }
  if (!Number.isInteger(warningPercent) || warningPercent < 1 || warningPercent > 100) {
    throw new Error("Process warning threshold must be 1–100%");
  }
  await env.DB.prepare(`INSERT INTO process_budgets
    (tenant_id, blueprint_id, monthly_limit_usd, warning_percent, hard_limit, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, blueprint_id) DO UPDATE SET monthly_limit_usd=excluded.monthly_limit_usd,
      warning_percent=excluded.warning_percent, hard_limit=excluded.hard_limit,
      updated_at=CURRENT_TIMESTAMP, updated_by=excluded.updated_by`)
    .bind(tenantId, blueprintId, monthlyLimitUsd, warningPercent, Number(Boolean(input.hardLimit)), actorId).run();
  return { blueprintId, enabled: true, monthlyLimitUsd, warningPercent, hardLimit: Boolean(input.hardLimit) };
}

export interface BillingEvidenceInput {
  periodStart?: string;
  periodEnd?: string;
  source?: string;
  sourceReference?: string;
  workersAiNeurons?: number | null;
  workersAiCostUsd?: number;
  platformCostUsd?: number | null;
  workersRequests?: number | null;
  d1RowsRead?: number | null;
  d1RowsWritten?: number | null;
  queueOperations?: number | null;
  workflowWallTimeMs?: number | null;
}

export async function importBillingEvidence(env: Env, tenantId: string, actorId: string, input: BillingEvidenceInput) {
  const periodStart = validDate(input.periodStart, "Period start");
  const periodEnd = validDate(input.periodEnd, "Period end");
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days < 1 || days > 366) throw new Error("Billing period must be 1–366 days");
  if (end.getTime() > Date.now() + 86_400_000) throw new Error("Billing period cannot end in the future");
  const source = String(input.source ?? "");
  if (!["cloudflare_dashboard", "cloudflare_invoice", "cloudflare_api", "other"].includes(source)) {
    throw new Error("Billing evidence source is invalid");
  }
  const sourceReference = String(input.sourceReference ?? "").trim();
  if (sourceReference.length < 3 || sourceReference.length > 120 ||
      !/^[A-Za-z0-9][A-Za-z0-9 ._:/#-]*$/.test(sourceReference)) {
    throw new Error("Source reference must be a 3–120 character identifier");
  }
  const normalized = {
    periodStart, periodEnd, source, sourceReference,
    workersAiNeurons: optionalNumber(input.workersAiNeurons, "Workers AI neurons"),
    workersAiCostUsd: requiredNumber(input.workersAiCostUsd, "Workers AI cost"),
    platformCostUsd: optionalNumber(input.platformCostUsd, "Platform cost"),
    workersRequests: optionalInteger(input.workersRequests, "Worker requests"),
    d1RowsRead: optionalInteger(input.d1RowsRead, "D1 rows read"),
    d1RowsWritten: optionalInteger(input.d1RowsWritten, "D1 rows written"),
    queueOperations: optionalInteger(input.queueOperations, "Queue operations"),
    workflowWallTimeMs: optionalInteger(input.workflowWallTimeMs, "Workflow wall time")
  };
  const estimate = await env.DB.prepare(`SELECT
    (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM executions WHERE tenant_id=?
      AND date(started_at)>=date(?) AND date(started_at)<=date(?)) +
    (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM evaluation_case_results WHERE tenant_id=?
      AND date(created_at)>=date(?) AND date(created_at)<=date(?)) estimated`)
    .bind(tenantId, periodStart, periodEnd, tenantId, periodStart, periodEnd)
    .first<{ estimated: number }>();
  const estimated = Number(estimate?.estimated ?? 0);
  const variance = normalized.workersAiCostUsd - estimated;
  const variancePercent = estimated > 0 ? variance / estimated * 100 : null;
  const checksum = await sha256(JSON.stringify(normalized));
  const existing = await env.DB.prepare(`SELECT id, status FROM billing_reconciliations
    WHERE tenant_id=? AND checksum=?`).bind(tenantId, checksum).first<{ id: string; status: string }>();
  if (existing) return { id: existing.id, status: existing.status, imported: false };
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO billing_reconciliations
      (id, tenant_id, period_start, period_end, source, source_reference, workers_ai_neurons,
       workers_ai_cost_usd, platform_cost_usd, workers_requests, d1_rows_read, d1_rows_written,
       queue_operations, workflow_wall_time_ms, workrr_estimated_ai_cost_usd, variance_usd,
       variance_percent, checksum, imported_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, tenantId, periodStart, periodEnd, source, sourceReference, normalized.workersAiNeurons,
        normalized.workersAiCostUsd, normalized.platformCostUsd, normalized.workersRequests,
        normalized.d1RowsRead, normalized.d1RowsWritten, normalized.queueOperations,
        normalized.workflowWallTimeMs, estimated, variance, variancePercent, checksum, actorId),
    audit(env, tenantId, actorId, "billing.reconciliation_imported", id, {
      periodStart, periodEnd, source, sourceReference, estimated, billed: normalized.workersAiCostUsd,
      variance, variancePercent
    })
  ]);
  return { id, status: "active", imported: true, estimated, billed: normalized.workersAiCostUsd,
    variance, variancePercent };
}

export async function voidBillingEvidence(env: Env, tenantId: string, actorId: string, id: string,
  reasonValue: unknown) {
  const reason = String(reasonValue ?? "").trim();
  if (reason.length < 10 || reason.length > 500) throw new Error("Void reason must be 10–500 characters");
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE billing_reconciliations SET status='voided', voided_by=?,
    voided_at=?, void_reason=? WHERE id=? AND tenant_id=? AND status='active'`)
    .bind(actorId, now, reason, id, tenantId).run();
  if (result.meta.changes !== 1) throw new Error("Active billing evidence was not found");
  await audit(env, tenantId, actorId, "billing.reconciliation_voided", id, { reason }).run();
  return { id, status: "voided" };
}

export function pricedCompletionSql() {
  return `UPDATE executions SET status = 'completed', output_preview = ?, model = ?, input_tokens = ?, output_tokens = ?, total_tokens = ?,
    estimated_cost_usd = ((? * COALESCE((SELECT input_usd_per_million FROM model_catalog WHERE model_id = ?),0)) +
      (? * COALESCE((SELECT output_usd_per_million FROM model_catalog WHERE model_id = ?),0))) / 1000000.0,
    completed_at = ? WHERE id = ?`;
}

function validDate(value: unknown, label: string) {
  const text = String(value ?? "");
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return text;
}
function requiredNumber(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) throw new Error(`${label} is invalid`);
  return number;
}
function optionalNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredNumber(value, label);
}
function optionalInteger(value: unknown, label: string): number | null {
  const number = optionalNumber(value, label);
  if (number !== null && !Number.isSafeInteger(number)) throw new Error(`${label} must be a whole number`);
  return number;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function audit(env: Env, tenantId: string, actorId: string, eventType: string, id: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'billing_reconciliation', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, id, JSON.stringify(detail));
}
