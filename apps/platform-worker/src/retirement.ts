import { getAgentByName } from "agents";
import type { Env } from "./types";
import type { ProcessAgent } from "./agent";

const openStatuses = ["requested", "approved", "disposing", "failed"];

export async function getProcessRetirement(env: Env, tenantId: string, blueprintId: string) {
  const process = await env.DB.prepare(`SELECT id, name, status, operating_mode FROM agent_blueprints
    WHERE id=? AND tenant_id=?`).bind(blueprintId, tenantId)
    .first<{ id: string; name: string; status: string; operating_mode: string }>();
  if (!process) throw new Error("Process not found");
  const { results } = await env.DB.prepare(`SELECT r.*,
    requester.display_name requested_by_name, approver.display_name approved_by_name
    FROM process_retirements r
    LEFT JOIN tenant_members requester ON requester.id=r.requested_by AND requester.tenant_id=r.tenant_id
    LEFT JOIN tenant_members approver ON approver.id=r.approved_by AND approver.tenant_id=r.tenant_id
    WHERE r.tenant_id=? AND r.blueprint_id=? ORDER BY r.requested_at DESC LIMIT 20`)
    .bind(tenantId, blueprintId).all();
  return { process, retirements: results };
}

export async function requestProcessRetirement(env: Env, tenantId: string, actorId: string, blueprintId: string,
  input: { reason?: string; confirmName?: string; deleteExecutionPayloads?: boolean;
    deleteApprovalContent?: boolean; deletePromptContent?: boolean }) {
  const process = await env.DB.prepare(`SELECT id, name FROM agent_blueprints WHERE id=? AND tenant_id=?`)
    .bind(blueprintId, tenantId).first<{ id: string; name: string }>();
  if (!process) throw new Error("Process not found");
  if (input.confirmName?.trim() !== process.name) throw new Error("Enter the exact process name to request retirement");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 20 || reason.length > 2000) throw new Error("Retirement reason must be 20–2,000 characters");
  const existing = await env.DB.prepare(`SELECT id FROM process_retirements WHERE tenant_id=? AND blueprint_id=?
    AND status IN ('requested','approved','disposing','failed')`).bind(tenantId, blueprintId).first();
  if (existing) throw new Error("This process already has an open retirement");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO process_retirements
      (id, tenant_id, blueprint_id, status, reason, requested_by, delete_execution_payloads,
       delete_approval_content, delete_prompt_content)
      VALUES (?, ?, ?, 'requested', ?, ?, ?, ?, ?)`)
      .bind(id, tenantId, blueprintId, reason, actorId, Number(input.deleteExecutionPayloads !== false),
        Number(input.deleteApprovalContent !== false), Number(Boolean(input.deletePromptContent))),
    env.DB.prepare(`UPDATE agent_blueprints SET status='paused', operating_mode='paused', updated_at=?
      WHERE id=? AND tenant_id=?`).bind(now, blueprintId, tenantId),
    env.DB.prepare(`UPDATE process_schedules SET status='paused', updated_at=? WHERE blueprint_id=? AND tenant_id=?`)
      .bind(now, blueprintId, tenantId),
    env.DB.prepare(`UPDATE webhook_endpoints SET status='disabled' WHERE blueprint_id=? AND tenant_id=?`)
      .bind(blueprintId, tenantId),
    audit(env, tenantId, actorId, "process.retirement_requested", blueprintId, { retirementId: id, reason })
  ]);
  return { id, status: "requested", processPaused: true };
}

export async function transitionProcessRetirement(env: Env, tenantId: string, actorId: string,
  retirementId: string, input: { action?: string; scheduledFor?: string; legalHold?: boolean;
    legalHoldReason?: string; confirmation?: string }) {
  const retirement = await env.DB.prepare(`SELECT r.*, b.name process_name FROM process_retirements r
    JOIN agent_blueprints b ON b.id=r.blueprint_id AND b.tenant_id=r.tenant_id
    WHERE r.id=? AND r.tenant_id=?`).bind(retirementId, tenantId).first<Record<string, unknown>>();
  if (!retirement) throw new Error("Retirement was not found");
  const action = input.action;
  if (action === "hold") {
    if (!input.legalHold && String(input.confirmation ?? "") !== "RELEASE LEGAL HOLD") {
      throw new Error("Releasing a legal hold requires the exact confirmation");
    }
    const reason = input.legalHoldReason?.trim() ?? "";
    if (input.legalHold && reason.length < 10) throw new Error("Legal hold reason must be at least 10 characters");
    await env.DB.batch([
      env.DB.prepare(`UPDATE process_retirements SET legal_hold=?, legal_hold_reason=?, updated_at=?
        WHERE id=? AND tenant_id=? AND status IN ('requested','approved','failed')`)
        .bind(Number(Boolean(input.legalHold)), input.legalHold ? reason.slice(0, 2000) : null,
          new Date().toISOString(), retirementId, tenantId),
      audit(env, tenantId, actorId, input.legalHold ? "process.legal_hold_applied" : "process.legal_hold_released",
        String(retirement.blueprint_id), { retirementId, reason: input.legalHold ? reason : null })
    ]);
    return { id: retirementId, status: retirement.status, legalHold: Boolean(input.legalHold) };
  }
  if (action === "approve") {
    if (retirement.status !== "requested" && retirement.status !== "failed") throw new Error("Only requested or failed retirement can be approved");
    if (Number(retirement.legal_hold)) throw new Error("Release the legal hold before approving disposal");
    if (retirement.requested_by === actorId) throw new Error("A different administrator or owner must approve irreversible disposal");
    if (input.confirmation !== String(retirement.process_name)) throw new Error("Enter the exact process name to approve disposal");
    const scheduled = new Date(String(input.scheduledFor ?? ""));
    const min = Date.now() + 24 * 60 * 60_000;
    const max = Date.now() + 90 * 24 * 60 * 60_000;
    if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() < min || scheduled.getTime() > max) {
      throw new Error("Disposal must be scheduled 24 hours to 90 days from now");
    }
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE process_retirements SET status='approved', approved_by=?, approved_at=?,
        scheduled_for=?, last_error=NULL, updated_at=? WHERE id=? AND tenant_id=?`)
        .bind(actorId, now, scheduled.toISOString(), now, retirementId, tenantId),
      audit(env, tenantId, actorId, "process.retirement_approved", String(retirement.blueprint_id),
        { retirementId, scheduledFor: scheduled.toISOString() })
    ]);
    return { id: retirementId, status: "approved", scheduledFor: scheduled.toISOString() };
  }
  if (action === "cancel") {
    if (!openStatuses.includes(String(retirement.status)) || retirement.status === "disposing") {
      throw new Error("This retirement can no longer be cancelled");
    }
    if (input.confirmation !== "CANCEL RETIREMENT") throw new Error("Cancellation requires the exact confirmation");
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE process_retirements SET status='cancelled', updated_at=?
        WHERE id=? AND tenant_id=?`).bind(now, retirementId, tenantId),
      audit(env, tenantId, actorId, "process.retirement_cancelled", String(retirement.blueprint_id), { retirementId })
    ]);
    return { id: retirementId, status: "cancelled" };
  }
  throw new Error("Valid retirement action is required");
}

export async function enqueueDueProcessDisposals(env: Env, now = new Date()) {
  const { results } = await env.DB.prepare(`SELECT id, tenant_id FROM process_retirements
    WHERE status='approved' AND legal_hold=0 AND datetime(scheduled_for)<=datetime(?)
    ORDER BY scheduled_for LIMIT 20`).bind(now.toISOString()).all<{ id: string; tenant_id: string }>();
  let queued = 0;
  for (const item of results) {
    const jobId = crypto.randomUUID();
    const claim = await env.DB.prepare(`UPDATE process_retirements SET status='disposing', disposal_job_id=?,
      updated_at=? WHERE id=? AND tenant_id=? AND status='approved' AND legal_hold=0`)
      .bind(jobId, now.toISOString(), item.id, item.tenant_id).run();
    if (claim.meta.changes !== 1) continue;
    try {
      await env.PROCESS_DISPOSAL_WORKFLOW.create({
        id: jobId, params: { tenantId: item.tenant_id, retirementId: item.id }
      });
      queued += 1;
    } catch (error) {
      await env.DB.prepare(`UPDATE process_retirements SET status='approved', disposal_job_id=NULL,
        last_error=?, updated_at=? WHERE id=? AND tenant_id=? AND status='disposing'`)
        .bind(String(error).slice(0, 500), now.toISOString(), item.id, item.tenant_id).run();
    }
  }
  return { queued };
}

export async function disposeProcess(env: Env, tenantId: string, retirementId: string) {
  const retirement = await env.DB.prepare(`SELECT * FROM process_retirements
    WHERE id=? AND tenant_id=? AND status='disposing' AND legal_hold=0`)
    .bind(retirementId, tenantId).first<Record<string, unknown>>();
  if (!retirement) throw new Error("Disposal job is not active or is protected by legal hold");
  const blueprintId = String(retirement.blueprint_id);
  try {
    const { results: instances } = await env.DB.prepare(`SELECT DISTINCT instance_key FROM executions
      WHERE tenant_id=? AND blueprint_id=? AND instance_key IS NOT NULL LIMIT 1001`)
      .bind(tenantId, blueprintId).all<{ instance_key: string }>();
    if (instances.length > 1000) throw new Error("More than 1,000 durable actors require a batched disposal Workflow");
    let turns = 0;
    let promptBundles = 0;
    for (let offset = 0; offset < instances.length; offset += 20) {
      const results = await Promise.all(instances.slice(offset, offset + 20).map(async ({ instance_key }) => {
        const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, instance_key);
        return agent.eraseData(tenantId, blueprintId);
      }));
      for (const result of results) { turns += result.turns; promptBundles += result.promptBundles; }
    }
    const now = new Date().toISOString();
    const statements = [
      env.DB.prepare(`UPDATE process_schedules SET status='paused', input_text='[disposed]', updated_at=?
        WHERE tenant_id=? AND blueprint_id=?`).bind(now, tenantId, blueprintId),
      env.DB.prepare(`UPDATE webhook_endpoints SET status='disabled' WHERE tenant_id=? AND blueprint_id=?`)
        .bind(tenantId, blueprintId),
      env.DB.prepare(`UPDATE agent_blueprints SET status='paused', operating_mode='paused',
        description='Retired process — operational configuration retained for audit.', updated_at=?
        WHERE tenant_id=? AND id=?`).bind(now, tenantId, blueprintId)
    ];
    if (Number(retirement.delete_execution_payloads)) statements.push(
      env.DB.prepare(`UPDATE executions SET input_preview='[disposed]', output_preview=NULL, error=NULL
        WHERE tenant_id=? AND blueprint_id=?`).bind(tenantId, blueprintId)
    );
    if (Number(retirement.delete_approval_content)) {
      statements.push(
        env.DB.prepare(`UPDATE approvals SET action_input_json='{"disposed":true}'
          WHERE tenant_id=? AND execution_id IN (SELECT id FROM executions WHERE tenant_id=? AND blueprint_id=?)`)
          .bind(tenantId, tenantId, blueprintId),
        env.DB.prepare(`UPDATE approval_messages SET body='[disposed]'
          WHERE tenant_id=? AND approval_id IN (SELECT a.id FROM approvals a JOIN executions e
            ON e.id=a.execution_id AND e.tenant_id=a.tenant_id WHERE a.tenant_id=? AND e.blueprint_id=?)`)
          .bind(tenantId, tenantId, blueprintId)
      );
    }
    if (Number(retirement.delete_prompt_content)) statements.push(
      env.DB.prepare(`UPDATE prompt_releases SET system_prompt='[disposed]', instructions_json='[]',
        guardrails_json='[]' WHERE blueprint_id=?`).bind(blueprintId)
    );
    const evidence = { durableActors: instances.length, conversationTurns: turns, agentPromptBundles: promptBundles,
      executionPayloads: Boolean(retirement.delete_execution_payloads),
      approvalContent: Boolean(retirement.delete_approval_content),
      promptContent: Boolean(retirement.delete_prompt_content),
      auditRetained: true, disposedAt: now };
    statements.push(
      env.DB.prepare(`UPDATE process_retirements SET status='disposed', disposed_at=?, disposed_by='system',
        evidence_json=?, last_error=NULL, updated_at=? WHERE id=? AND tenant_id=?`)
        .bind(now, JSON.stringify(evidence), now, retirementId, tenantId),
      audit(env, tenantId, "system", "process.disposed", blueprintId, { retirementId, ...evidence })
    );
    await env.DB.batch(statements);
    return evidence;
  } catch (error) {
    await env.DB.prepare(`UPDATE process_retirements SET status='failed', last_error=?, updated_at=?
      WHERE id=? AND tenant_id=?`).bind(
        (error instanceof Error ? error.message : String(error)).slice(0, 500),
        new Date().toISOString(), retirementId, tenantId).run();
    throw error;
  }
}

export async function loadDisposalBatch(env: Env, tenantId: string, retirementId: string,
  cursor: string, limit = 100) {
  const retirement = await env.DB.prepare(`SELECT blueprint_id FROM process_retirements
    WHERE id=? AND tenant_id=? AND status='disposing' AND legal_hold=0`)
    .bind(retirementId, tenantId).first<{ blueprint_id: string }>();
  if (!retirement) throw new Error("Disposal Workflow is not active or is protected by legal hold");
  const result = await env.DB.prepare(`SELECT DISTINCT instance_key FROM executions
    WHERE tenant_id=? AND blueprint_id=? AND instance_key IS NOT NULL AND instance_key>?
    ORDER BY instance_key LIMIT ?`).bind(tenantId, retirement.blueprint_id, cursor, limit)
    .all<{ instance_key: string }>();
  return result.results.map((item) => item.instance_key);
}

export async function eraseDisposalBatch(env: Env, tenantId: string, retirementId: string,
  instanceKeys: string[]) {
  const retirement = await env.DB.prepare(`SELECT blueprint_id FROM process_retirements
    WHERE id=? AND tenant_id=? AND status='disposing' AND legal_hold=0`)
    .bind(retirementId, tenantId).first<{ blueprint_id: string }>();
  if (!retirement) throw new Error("Disposal Workflow is not active or is protected by legal hold");
  let conversationTurns = 0;
  let agentPromptBundles = 0;
  for (let offset = 0; offset < instanceKeys.length; offset += 20) {
    const results = await Promise.all(instanceKeys.slice(offset, offset + 20).map(async (instanceKey) => {
      const agent = await getAgentByName<Env, ProcessAgent>(env.PROCESS_AGENT, instanceKey);
      return agent.eraseData(tenantId, retirement.blueprint_id);
    }));
    for (const result of results) {
      conversationTurns += result.turns;
      agentPromptBundles += result.promptBundles;
    }
  }
  return { durableActors: instanceKeys.length, conversationTurns, agentPromptBundles };
}

export async function recordDisposalProgress(env: Env, tenantId: string, retirementId: string,
  cursor: string, counts: { durableActors: number; conversationTurns: number; agentPromptBundles: number }) {
  await env.DB.prepare(`UPDATE process_retirements SET disposal_cursor=?, processed_actors=?,
    disposed_turns=?, disposed_prompt_bundles=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND status='disposing'`)
    .bind(cursor, counts.durableActors, counts.conversationTurns, counts.agentPromptBundles,
      retirementId, tenantId).run();
  return counts;
}

export async function finalizeProcessDisposal(env: Env, tenantId: string, retirementId: string,
  counts: { durableActors: number; conversationTurns: number; agentPromptBundles: number }) {
  const retirement = await env.DB.prepare(`SELECT * FROM process_retirements
    WHERE id=? AND tenant_id=? AND status='disposing' AND legal_hold=0`)
    .bind(retirementId, tenantId).first<Record<string, unknown>>();
  if (!retirement) throw new Error("Disposal Workflow is not active or is protected by legal hold");
  const blueprintId = String(retirement.blueprint_id);
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`UPDATE process_schedules SET status='paused', input_text='[disposed]', updated_at=?
      WHERE tenant_id=? AND blueprint_id=?`).bind(now, tenantId, blueprintId),
    env.DB.prepare(`UPDATE webhook_endpoints SET status='disabled' WHERE tenant_id=? AND blueprint_id=?`)
      .bind(tenantId, blueprintId),
    env.DB.prepare(`UPDATE agent_blueprints SET status='paused', operating_mode='paused',
      description='Retired process — operational configuration retained for audit.', updated_at=?
      WHERE tenant_id=? AND id=?`).bind(now, tenantId, blueprintId)
  ];
  if (Number(retirement.delete_execution_payloads)) statements.push(
    env.DB.prepare(`UPDATE executions SET input_preview='[disposed]', output_preview=NULL, error=NULL
      WHERE tenant_id=? AND blueprint_id=?`).bind(tenantId, blueprintId)
  );
  if (Number(retirement.delete_approval_content)) statements.push(
    env.DB.prepare(`UPDATE approvals SET action_input_json='{"disposed":true}'
      WHERE tenant_id=? AND execution_id IN (SELECT id FROM executions WHERE tenant_id=? AND blueprint_id=?)`)
      .bind(tenantId, tenantId, blueprintId),
    env.DB.prepare(`UPDATE approval_messages SET body='[disposed]'
      WHERE tenant_id=? AND approval_id IN (SELECT a.id FROM approvals a JOIN executions e
        ON e.id=a.execution_id AND e.tenant_id=a.tenant_id WHERE a.tenant_id=? AND e.blueprint_id=?)`)
      .bind(tenantId, tenantId, blueprintId)
  );
  if (Number(retirement.delete_prompt_content)) statements.push(
    env.DB.prepare(`UPDATE prompt_releases SET system_prompt='[disposed]', instructions_json='[]',
      guardrails_json='[]' WHERE blueprint_id=?`).bind(blueprintId)
  );
  const evidence = { ...counts, executionPayloads: Boolean(retirement.delete_execution_payloads),
    approvalContent: Boolean(retirement.delete_approval_content),
    promptContent: Boolean(retirement.delete_prompt_content), auditRetained: true, disposedAt: now };
  statements.push(
    env.DB.prepare(`UPDATE process_retirements SET status='disposed', disposed_at=?, disposed_by='system',
      evidence_json=?, processed_actors=?, disposed_turns=?, disposed_prompt_bundles=?,
      disposal_cursor=NULL, last_error=NULL, updated_at=? WHERE id=? AND tenant_id=?`)
      .bind(now, JSON.stringify(evidence), counts.durableActors, counts.conversationTurns,
        counts.agentPromptBundles, now, retirementId, tenantId),
    audit(env, tenantId, "system", "process.disposed", blueprintId, { retirementId, ...evidence })
  );
  await env.DB.batch(statements);
  return evidence;
}

export async function failProcessDisposal(env: Env, tenantId: string, retirementId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await env.DB.prepare(`UPDATE process_retirements SET status='failed', last_error=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND status='disposing'`).bind(message, retirementId, tenantId).run();
  return { status: "failed", error: message };
}

function audit(env: Env, tenantId: string, actorId: string, eventType: string, blueprintId: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'process', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, blueprintId, JSON.stringify(detail));
}
