import { getAgentByName } from "agents";
import type { Env } from "./types";
import type { ProcessAgent } from "./agent";

const defaults = {
  conversation_days: 90,
  execution_days: 365,
  approval_days: 365,
  notification_days: 180,
  api_log_days: 90,
  legal_hold: 0,
  legal_hold_reason: null,
  updated_by: "system",
  updated_at: null,
  last_enforced_at: null
};

export async function getRetentionOperations(env: Env, tenantId: string) {
  const control = await env.DB.prepare(`SELECT * FROM tenant_retention_controls WHERE tenant_id=?`)
    .bind(tenantId).first<Record<string, unknown>>();
  const { results: runs } = await env.DB.prepare(`SELECT id, status, evidence_json, error, started_at, completed_at
    FROM retention_enforcement_runs WHERE tenant_id=? ORDER BY started_at DESC LIMIT 10`)
    .bind(tenantId).all();
  return { control: control ?? { tenant_id: tenantId, ...defaults }, runs };
}

export async function updateRetentionControls(env: Env, tenantId: string, actorId: string, input: Record<string, unknown>) {
  const days = {
    conversation: boundedDays(input.conversationDays, "Conversation"),
    execution: boundedDays(input.executionDays, "Execution"),
    approval: boundedDays(input.approvalDays, "Approval"),
    notification: boundedDays(input.notificationDays, "Notification"),
    apiLog: boundedDays(input.apiLogDays, "API log")
  };
  const legalHold = Boolean(input.legalHold);
  const reason = String(input.legalHoldReason ?? "").trim();
  if (legalHold && reason.length < 10) throw new Error("Legal hold reason must be at least 10 characters");
  if (!legalHold && input.releaseConfirmation !== "RELEASE TENANT LEGAL HOLD") {
    const current = await env.DB.prepare(`SELECT legal_hold FROM tenant_retention_controls WHERE tenant_id=?`)
      .bind(tenantId).first<{ legal_hold: number }>();
    if (Number(current?.legal_hold)) throw new Error("Releasing the legal hold requires the exact confirmation");
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO tenant_retention_controls
      (tenant_id, conversation_days, execution_days, approval_days, notification_days, api_log_days,
       legal_hold, legal_hold_reason, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET conversation_days=excluded.conversation_days,
       execution_days=excluded.execution_days, approval_days=excluded.approval_days,
       notification_days=excluded.notification_days, api_log_days=excluded.api_log_days,
       legal_hold=excluded.legal_hold, legal_hold_reason=excluded.legal_hold_reason,
       updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .bind(tenantId, days.conversation, days.execution, days.approval, days.notification, days.apiLog,
        Number(legalHold), legalHold ? reason.slice(0, 2000) : null, actorId, now),
    audit(env, tenantId, actorId, legalHold ? "retention.legal_hold_applied" : "retention.policy_updated", {
      ...days, legalHold, reason: legalHold ? reason : null
    })
  ]);
  return getRetentionOperations(env, tenantId);
}

export async function previewRetention(env: Env, tenantId: string, now = new Date()) {
  const policy = await control(env, tenantId);
  const cutoffs = cutoffMap(policy, now);
  const [executions, approvals, messages, notifications, logs, actors] = await Promise.all([
    count(env, `SELECT COUNT(*) count FROM executions WHERE tenant_id=? AND datetime(started_at)<datetime(?)
      AND input_preview!='[retention expired]' AND NOT EXISTS (SELECT 1 FROM process_retirements r
        WHERE r.tenant_id=executions.tenant_id AND r.blueprint_id=executions.blueprint_id AND r.legal_hold=1
        AND r.status IN ('requested','approved','failed'))`, tenantId, cutoffs.execution),
    count(env, `SELECT COUNT(*) count FROM approvals WHERE tenant_id=? AND datetime(requested_at)<datetime(?)
      AND action_input_json!='{"retentionExpired":true}' AND execution_id IN
        (SELECT e.id FROM executions e WHERE e.tenant_id=? AND NOT EXISTS (SELECT 1 FROM process_retirements r
          WHERE r.tenant_id=e.tenant_id AND r.blueprint_id=e.blueprint_id AND r.legal_hold=1
          AND r.status IN ('requested','approved','failed')))`, tenantId, cutoffs.approval, tenantId),
    count(env, `SELECT COUNT(*) count FROM approval_messages WHERE tenant_id=? AND datetime(created_at)<datetime(?)
      AND body!='[retention expired]' AND approval_id IN
        (SELECT a.id FROM approvals a JOIN executions e ON e.id=a.execution_id WHERE a.tenant_id=?
          AND NOT EXISTS (SELECT 1 FROM process_retirements r WHERE r.tenant_id=e.tenant_id
            AND r.blueprint_id=e.blueprint_id AND r.legal_hold=1
            AND r.status IN ('requested','approved','failed')))`, tenantId, cutoffs.approval, tenantId),
    count(env, `SELECT COUNT(*) count FROM notification_events WHERE tenant_id=? AND datetime(created_at)<datetime(?)
      AND detail!='[retention expired]'`, tenantId, cutoffs.notification),
    count(env, `SELECT COUNT(*) count FROM api_logs WHERE tenant_id=? AND datetime(created_at)<datetime(?)`,
      tenantId, cutoffs.apiLog),
    env.DB.prepare(`SELECT COUNT(DISTINCT instance_key) count FROM executions WHERE tenant_id=?
      AND instance_key IS NOT NULL AND datetime(started_at)<datetime(?)
      AND NOT EXISTS (SELECT 1 FROM process_retirements r WHERE r.tenant_id=executions.tenant_id
        AND r.blueprint_id=executions.blueprint_id AND r.legal_hold=1
        AND r.status IN ('requested','approved','failed'))`)
      .bind(tenantId, cutoffs.conversation).first<{ count: number }>()
  ]);
  return { legalHold: Boolean(policy.legal_hold), cutoffs,
    eligible: { executions, approvals, approvalMessages: messages, notifications, apiLogs: logs,
      durableActors: Number(actors?.count ?? 0) } };
}

export async function enforceTenantRetention(env: Env, tenantId: string, now = new Date()) {
  const policy = await control(env, tenantId);
  if (Number(policy.legal_hold)) return { skipped: true, reason: "tenant_legal_hold" };
  const startedAt = now.toISOString();
  const runId = crypto.randomUUID();
  try {
    const cutoffs = cutoffMap(policy, now);
    const { results: instances } = await env.DB.prepare(`SELECT DISTINCT e.instance_key, e.blueprint_id
      FROM executions e WHERE e.tenant_id=? AND e.instance_key IS NOT NULL
      AND datetime(e.started_at)<datetime(?)
      AND NOT EXISTS (SELECT 1 FROM process_retirements r WHERE r.tenant_id=e.tenant_id
        AND r.blueprint_id=e.blueprint_id AND r.legal_hold=1
        AND r.status IN ('requested','approved','failed')) LIMIT 201`)
      .bind(tenantId, cutoffs.conversation).all<{ instance_key: string; blueprint_id: string }>();
    if (instances.length > 200) throw new Error("More than 200 durable actors require a batched retention Workflow");
    let conversationTurns = 0;
    for (let offset = 0; offset < instances.length; offset += 20) {
      const results = await Promise.all(instances.slice(offset, offset + 20).map(async (item) => {
        const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, item.instance_key);
        return agent.expireConversationBefore(tenantId, item.blueprint_id, cutoffs.conversation);
      }));
      conversationTurns += results.reduce((sum, result) => sum + result.deleted, 0);
    }
    const statements = [
      env.DB.prepare(`UPDATE executions SET input_preview='[retention expired]', output_preview=NULL, error=NULL
        WHERE tenant_id=? AND datetime(started_at)<datetime(?) AND input_preview!='[retention expired]'
        AND NOT EXISTS (SELECT 1 FROM process_retirements r WHERE r.tenant_id=executions.tenant_id
          AND r.blueprint_id=executions.blueprint_id AND r.legal_hold=1
          AND r.status IN ('requested','approved','failed'))`).bind(tenantId, cutoffs.execution),
      env.DB.prepare(`UPDATE approvals SET action_input_json='{"retentionExpired":true}'
        WHERE tenant_id=? AND datetime(requested_at)<datetime(?) AND action_input_json!='{"retentionExpired":true}'
        AND execution_id IN (SELECT e.id FROM executions e WHERE e.tenant_id=?
          AND NOT EXISTS (SELECT 1 FROM process_retirements r WHERE r.tenant_id=e.tenant_id
            AND r.blueprint_id=e.blueprint_id AND r.legal_hold=1
            AND r.status IN ('requested','approved','failed')))`).
        bind(tenantId, cutoffs.approval, tenantId),
      env.DB.prepare(`UPDATE approval_messages SET body='[retention expired]'
        WHERE tenant_id=? AND datetime(created_at)<datetime(?) AND body!='[retention expired]'
        AND approval_id IN (SELECT a.id FROM approvals a JOIN executions e ON e.id=a.execution_id
          WHERE a.tenant_id=? AND NOT EXISTS (SELECT 1 FROM process_retirements r
            WHERE r.tenant_id=e.tenant_id AND r.blueprint_id=e.blueprint_id AND r.legal_hold=1
            AND r.status IN ('requested','approved','failed')))`).
        bind(tenantId, cutoffs.approval, tenantId),
      env.DB.prepare(`UPDATE notification_events SET detail='[retention expired]'
        WHERE tenant_id=? AND datetime(created_at)<datetime(?) AND detail!='[retention expired]'`)
        .bind(tenantId, cutoffs.notification),
      env.DB.prepare(`DELETE FROM api_logs WHERE tenant_id=? AND datetime(created_at)<datetime(?)`)
        .bind(tenantId, cutoffs.apiLog)
    ];
    const results = await env.DB.batch(statements);
    const evidence = {
      conversationTurns,
      executionContent: Number(results[0]?.meta.changes ?? 0),
      approvalContent: Number(results[1]?.meta.changes ?? 0) + Number(results[2]?.meta.changes ?? 0),
      notificationContent: Number(results[3]?.meta.changes ?? 0),
      apiLogs: Number(results[4]?.meta.changes ?? 0),
      auditRetained: true,
      enforcedAt: startedAt
    };
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO retention_enforcement_runs
        (id, tenant_id, status, evidence_json, started_at, completed_at)
        VALUES (?, ?, 'completed', ?, ?, ?)`).bind(runId, tenantId, JSON.stringify(evidence), startedAt, new Date().toISOString()),
      env.DB.prepare(`UPDATE tenant_retention_controls SET last_enforced_at=? WHERE tenant_id=?`)
        .bind(startedAt, tenantId),
      audit(env, tenantId, "system", "retention.enforced", evidence)
    ]);
    return { skipped: false, runId, evidence };
  } catch (error) {
    await env.DB.prepare(`INSERT INTO retention_enforcement_runs
      (id, tenant_id, status, evidence_json, error, started_at, completed_at)
      VALUES (?, ?, 'failed', '{}', ?, ?, ?)`)
      .bind(runId, tenantId, String(error).slice(0, 500), startedAt, new Date().toISOString()).run();
    throw error;
  }
}

export async function enforceAllTenantRetention(env: Env, now = new Date()) {
  const { results } = await env.DB.prepare(`SELECT tenant_id FROM tenant_retention_controls
    WHERE legal_hold=0 AND (last_enforced_at IS NULL OR datetime(last_enforced_at)<datetime(?)) LIMIT 20`)
    .bind(new Date(now.getTime() - 20 * 60 * 60_000).toISOString()).all<{ tenant_id: string }>();
  return Promise.allSettled(results.map((item) => enforceTenantRetention(env, item.tenant_id, now)));
}

async function control(env: Env, tenantId: string) {
  return (await env.DB.prepare(`SELECT * FROM tenant_retention_controls WHERE tenant_id=?`)
    .bind(tenantId).first<Record<string, unknown>>()) ?? defaults;
}
function boundedDays(value: unknown, label: string) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 2555) throw new Error(`${label} retention must be 1–2,555 days`);
  return days;
}
function cutoffMap(policy: Record<string, unknown>, now: Date) {
  const cutoff = (days: unknown) => new Date(now.getTime() - Number(days) * 86_400_000).toISOString();
  return {
    conversation: cutoff(policy.conversation_days), execution: cutoff(policy.execution_days),
    approval: cutoff(policy.approval_days), notification: cutoff(policy.notification_days),
    apiLog: cutoff(policy.api_log_days)
  };
}
async function count(env: Env, sql: string, ...bindings: unknown[]) {
  const row = await env.DB.prepare(sql).bind(...bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}
function audit(env: Env, tenantId: string, actorId: string, eventType: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'retention', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, tenantId, JSON.stringify(detail));
}
