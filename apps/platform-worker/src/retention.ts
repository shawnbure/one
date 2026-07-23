import { getAgentByName } from "agents";
import type { Env } from "./types";
import type { ProcessAgent } from "./agent";

const defaults = {
  conversation_days: 90,
  execution_days: 365,
  approval_days: 365,
  notification_days: 180,
  help_request_days: 365,
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
  const { results: runs } = await env.DB.prepare(`SELECT id, status, workflow_id, processed_actors, expired_turns,
    evidence_json, error, started_at, completed_at
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
    helpRequest: boundedDays(input.helpRequestDays, "Help request"),
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
      (tenant_id, conversation_days, execution_days, approval_days, notification_days, help_request_days, api_log_days,
       legal_hold, legal_hold_reason, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET conversation_days=excluded.conversation_days,
       execution_days=excluded.execution_days, approval_days=excluded.approval_days,
       notification_days=excluded.notification_days, help_request_days=excluded.help_request_days,
       api_log_days=excluded.api_log_days,
       legal_hold=excluded.legal_hold, legal_hold_reason=excluded.legal_hold_reason,
       updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .bind(tenantId, days.conversation, days.execution, days.approval, days.notification, days.helpRequest, days.apiLog,
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
  const [executions, approvals, messages, notifications, helpRequests, logs, actors] = await Promise.all([
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
    count(env, `SELECT COUNT(*) count FROM help_requests WHERE tenant_id=? AND datetime(created_at)<datetime(?)
      AND detail!='[retention expired]'`, tenantId, cutoffs.helpRequest),
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
    eligible: { executions, approvals, approvalMessages: messages, notifications, helpRequests, apiLogs: logs,
      durableActors: Number(actors?.count ?? 0) } };
}

export async function enforceTenantRetention(env: Env, tenantId: string, now = new Date()) {
  const policy = await control(env, tenantId);
  if (Number(policy.legal_hold)) return { skipped: true, reason: "tenant_legal_hold" };
  const startedAt = now.toISOString();
  const runId = crypto.randomUUID();
  const cutoffs = cutoffMap(policy, now);
  try {
    await env.DB.prepare(`INSERT INTO retention_enforcement_runs
      (id, tenant_id, status, workflow_id, cutoffs_json, started_at) VALUES (?, ?, 'queued', ?, ?, ?)`)
      .bind(runId, tenantId, runId, JSON.stringify(cutoffs), startedAt).run();
    await env.RETENTION_WORKFLOW.create({ id: runId, params: { tenantId, runId } });
    await env.DB.prepare(`UPDATE tenant_retention_controls SET last_enforced_at=? WHERE tenant_id=?`)
      .bind(startedAt, tenantId).run();
    return { skipped: false, runId, status: "queued" as const };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await env.DB.prepare(`UPDATE retention_enforcement_runs SET status='failed', error=?, completed_at=?
      WHERE id=? AND tenant_id=? AND status='queued'`)
      .bind(message, new Date().toISOString(), runId, tenantId).run();
    throw error;
  }
}

export async function markRetentionRunning(env: Env, tenantId: string, runId: string) {
  await assertRetentionActive(env, tenantId, runId);
  await env.DB.prepare(`UPDATE retention_enforcement_runs SET status='running'
    WHERE id=? AND tenant_id=? AND status='queued'`).bind(runId, tenantId).run();
  return { status: "running" };
}

export interface RetentionActorBatchItem { instanceKey: string; blueprintId: string; cursor: string }

export async function loadRetentionActorBatch(env: Env, tenantId: string, runId: string,
  cursor: string, limit = 100): Promise<RetentionActorBatchItem[]> {
  const run = await assertRetentionActive(env, tenantId, runId);
  const cutoffs = parseCutoffs(run.cutoffs_json);
  const { results } = await env.DB.prepare(`SELECT DISTINCT e.instance_key, e.blueprint_id
    FROM executions e WHERE e.tenant_id=? AND e.instance_key IS NOT NULL
    AND (e.instance_key || char(31) || e.blueprint_id)>? AND datetime(e.started_at)<datetime(?)
    AND NOT EXISTS (SELECT 1 FROM process_retirements r WHERE r.tenant_id=e.tenant_id
      AND r.blueprint_id=e.blueprint_id AND r.legal_hold=1
      AND r.status IN ('requested','approved','disposing','failed'))
    ORDER BY e.instance_key, e.blueprint_id LIMIT ?`)
    .bind(tenantId, cursor, cutoffs.conversation, limit)
    .all<{ instance_key: string; blueprint_id: string }>();
  return results.map((item) => ({ instanceKey: item.instance_key, blueprintId: item.blueprint_id,
    cursor: `${item.instance_key}\u001f${item.blueprint_id}` }));
}

export async function expireRetentionActorBatch(env: Env, tenantId: string, runId: string,
  batch: RetentionActorBatchItem[]) {
  const run = await assertRetentionActive(env, tenantId, runId);
  const cutoff = parseCutoffs(run.cutoffs_json).conversation;
  let conversationTurns = 0;
  for (let offset = 0; offset < batch.length; offset += 20) {
    const results = await Promise.all(batch.slice(offset, offset + 20).map(async (item) => {
      const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, item.instanceKey);
      return agent.expireConversationBefore(tenantId, item.blueprintId, cutoff);
    }));
    conversationTurns += results.reduce((sum, result) => sum + result.deleted, 0);
  }
  return { durableActors: batch.length, conversationTurns };
}

export async function recordRetentionProgress(env: Env, tenantId: string, runId: string, cursor: string,
  counts: { durableActors: number; conversationTurns: number }) {
  await assertRetentionActive(env, tenantId, runId);
  await env.DB.prepare(`UPDATE retention_enforcement_runs SET actor_cursor=?, processed_actors=?, expired_turns=?
    WHERE id=? AND tenant_id=? AND status='running'`)
    .bind(cursor, counts.durableActors, counts.conversationTurns, runId, tenantId).run();
  return counts;
}

export async function finalizeRetentionWorkflow(env: Env, tenantId: string, runId: string,
  counts: { durableActors: number; conversationTurns: number }) {
  const run = await assertRetentionActive(env, tenantId, runId);
  const cutoffs = parseCutoffs(run.cutoffs_json);
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
      env.DB.prepare(`UPDATE help_requests SET subject='[retention expired]', detail='[retention expired]',
        resolution=CASE WHEN resolution IS NULL THEN NULL ELSE '[retention expired]' END,
        updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=? AND datetime(created_at)<datetime(?) AND detail!='[retention expired]'`)
        .bind(tenantId, cutoffs.helpRequest),
      env.DB.prepare(`DELETE FROM api_logs WHERE tenant_id=? AND datetime(created_at)<datetime(?)`)
        .bind(tenantId, cutoffs.apiLog)
    ];
  const results = await env.DB.batch(statements);
  const completedAt = new Date().toISOString();
    const evidence = {
      ...counts,
      executionContent: Number(results[0]?.meta.changes ?? 0),
      approvalContent: Number(results[1]?.meta.changes ?? 0) + Number(results[2]?.meta.changes ?? 0),
      notificationContent: Number(results[3]?.meta.changes ?? 0),
      helpRequestContent: Number(results[4]?.meta.changes ?? 0),
      apiLogs: Number(results[5]?.meta.changes ?? 0),
      auditRetained: true,
      enforcedAt: String(run.started_at)
    };
  await env.DB.batch([
      env.DB.prepare(`UPDATE retention_enforcement_runs SET status='completed', actor_cursor=NULL,
        processed_actors=?, expired_turns=?, evidence_json=?, error=NULL, completed_at=?
        WHERE id=? AND tenant_id=? AND status='running'`)
        .bind(counts.durableActors, counts.conversationTurns, JSON.stringify(evidence), completedAt, runId, tenantId),
      audit(env, tenantId, "system", "retention.enforced", evidence)
    ]);
  return evidence;
}

export async function failRetentionWorkflow(env: Env, tenantId: string, runId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await env.DB.prepare(`UPDATE retention_enforcement_runs SET status='failed', error=?, completed_at=?
    WHERE id=? AND tenant_id=? AND status IN ('queued','running')`)
    .bind(message, new Date().toISOString(), runId, tenantId).run();
  return { status: "failed", error: message };
}

export async function enforceAllTenantRetention(env: Env, now = new Date()) {
  const { results } = await env.DB.prepare(`SELECT tenant_id FROM tenant_retention_controls
    WHERE legal_hold=0 AND (last_enforced_at IS NULL OR datetime(last_enforced_at)<datetime(?)) LIMIT 20`)
    .bind(new Date(now.getTime() - 20 * 60 * 60_000).toISOString()).all<{ tenant_id: string }>();
  const settled = [];
  for (const item of results) {
    settled.push(await Promise.resolve(enforceTenantRetention(env, item.tenant_id, now))
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason) => ({ status: "rejected" as const, reason })));
  }
  return settled;
}

async function assertRetentionActive(env: Env, tenantId: string, runId: string) {
  const run = await env.DB.prepare(`SELECT r.* FROM retention_enforcement_runs r
    JOIN tenant_retention_controls c ON c.tenant_id=r.tenant_id
    WHERE r.id=? AND r.tenant_id=? AND r.status IN ('queued','running') AND c.legal_hold=0`)
    .bind(runId, tenantId).first<Record<string, unknown>>();
  if (!run) throw new Error("Retention Workflow is not active or is protected by tenant legal hold");
  return run;
}

function parseCutoffs(value: unknown) {
  const parsed = JSON.parse(String(value ?? "{}")) as Record<string, unknown>;
  for (const key of ["conversation", "execution", "approval", "notification", "helpRequest", "apiLog"]) {
    if (typeof parsed[key] !== "string" || Number.isNaN(Date.parse(parsed[key] as string))) {
      throw new Error("Retention Workflow cutoff snapshot is invalid");
    }
  }
  return parsed as Record<"conversation" | "execution" | "approval" | "notification" | "helpRequest" | "apiLog", string>;
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
    helpRequest: cutoff(policy.help_request_days), apiLog: cutoff(policy.api_log_days)
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
