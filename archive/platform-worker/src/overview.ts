import type { Env } from "./types";

export async function getOverviewData(env: Env, tenantId: string) {
  const [processes, runs, processRuns, approvals, usage, latency, durableWork, queue] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) count FROM agent_blueprints WHERE tenant_id=? AND status='active'")
      .bind(tenantId).first<{ count: number }>(),
    env.DB.prepare(`SELECT status, COUNT(*) count FROM executions
      WHERE tenant_id=? AND started_at>=datetime('now','-7 days') GROUP BY status`)
      .bind(tenantId).all<{ status: string; count: number }>(),
    env.DB.prepare(`SELECT blueprint_id, COUNT(*) count FROM executions
      WHERE tenant_id=? AND started_at>=datetime('now','-7 days') GROUP BY blueprint_id`)
      .bind(tenantId).all<{ blueprint_id: string; count: number }>(),
    env.DB.prepare("SELECT COUNT(*) count FROM approvals WHERE tenant_id=? AND status='pending'")
      .bind(tenantId).first<{ count: number }>(),
    env.DB.prepare(`SELECT COALESCE(SUM(input_tokens),0) input_tokens,
      COALESCE(SUM(output_tokens),0) output_tokens, COALESCE(SUM(total_tokens),0) total_tokens
      FROM executions WHERE tenant_id=? AND started_at>=datetime('now','-7 days')`)
      .bind(tenantId).first<{ input_tokens: number; output_tokens: number; total_tokens: number }>(),
    env.DB.prepare(`WITH durations AS (
        SELECT MAX(0, CAST((julianday(completed_at)-julianday(started_at))*86400000 AS INTEGER)) duration_ms
        FROM executions WHERE tenant_id=? AND completed_at IS NOT NULL
          AND started_at>=datetime('now','-7 days')
      ), ranked AS (
        SELECT duration_ms, ROW_NUMBER() OVER (ORDER BY duration_ms) rank,
          COUNT(*) OVER () sample_count FROM durations
      )
      SELECT duration_ms p95_ms, sample_count FROM ranked
      WHERE rank>=CAST((sample_count*95+99)/100 AS INTEGER) ORDER BY rank LIMIT 1`)
      .bind(tenantId).first<{ p95_ms: number; sample_count: number }>(),
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM executions WHERE tenant_id=? AND execution_profile='workflow' AND status='running') +
      (SELECT COUNT(*) FROM evaluation_runs WHERE tenant_id=? AND status IN ('queued','running')) +
      (SELECT COUNT(*) FROM actor_release_rollouts WHERE tenant_id=? AND status IN ('queued','running')) +
      (SELECT COUNT(*) FROM retention_enforcement_runs WHERE tenant_id=? AND status IN ('queued','running')) +
      (SELECT COUNT(*) FROM process_retirements WHERE tenant_id=? AND status='disposing') count`)
      .bind(tenantId, tenantId, tenantId, tenantId, tenantId).first<{ count: number }>(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN status IN ('queued','processing','retrying') THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN status IN ('dead_lettered','enqueue_failed') THEN 1 ELSE 0 END) attention
      FROM process_queue_jobs WHERE tenant_id=?`)
      .bind(tenantId).first<{ active: number | null; attention: number | null }>()
  ]);
  const byStatus = Object.fromEntries(runs.results.map((row) => [row.status, Number(row.count)]));
  const completed = byStatus.completed ?? 0;
  const unsuccessful = (byStatus.failed ?? 0) + (byStatus.blocked ?? 0);
  const terminal = completed + unsuccessful;
  return {
    activeProcesses: Number(processes?.count ?? 0),
    pendingApprovals: Number(approvals?.count ?? 0),
    runs7d: Object.values(byStatus).reduce((total, count) => total + count, 0),
    completed7d: completed,
    failed7d: byStatus.failed ?? 0,
    processRuns: Object.fromEntries(processRuns.results.map((row) => [row.blueprint_id, Number(row.count)])),
    usage7d: usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    operationalHealth: {
      windowDays: 7,
      terminalRuns: terminal,
      successRate: terminal ? Math.round((completed / terminal) * 1000) / 10 : null,
      p95ResponseMs: latency ? Number(latency.p95_ms) : null,
      latencySamples: Number(latency?.sample_count ?? 0),
      activeDurableWork: Number(durableWork?.count ?? 0),
      activeQueueJobs: Number(queue?.active ?? 0),
      queueAttention: Number(queue?.attention ?? 0),
      status: Number(queue?.attention ?? 0) > 0 || unsuccessful > 0 ? "attention" as const
        : terminal > 0 ? "healthy" as const : "unobserved" as const
    }
  };
}
