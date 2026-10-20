import type { AutonomyLevel } from "@workrr/contracts";
import type { Env } from "./types";
import { emitNotification } from "./notifications";

export type SafetyTrigger = "unsafe_shadow" | "unsafe_evaluation" | "reliability";

export interface AutonomySafetyState {
  enabled: boolean;
  minTerminalRuns: number;
  successThreshold: number;
  windowHours: number;
  cap: AutonomyLevel | null;
  reason: string | null;
  trigger: SafetyTrigger | null;
  evidenceId: string | null;
  triggeredAt: string | null;
  clearedAt: string | null;
  revision: number;
}

interface SafetyRow {
  id: string;
  tenant_id: string;
  name: string;
  autonomy: AutonomyLevel;
  fallback_enabled: number;
  fallback_min_terminal_runs: number;
  fallback_success_threshold: number;
  fallback_window_hours: number;
  safety_autonomy_cap: AutonomyLevel | null;
  safety_cap_reason: string | null;
  safety_cap_trigger: SafetyTrigger | null;
  safety_cap_evidence_id: string | null;
  safety_cap_triggered_at: string | null;
  safety_cap_cleared_at: string | null;
  safety_cap_revision: number;
}

const autonomyRank: Record<AutonomyLevel, number> = {
  observe: 0, suggest: 1, approve: 2, guarded: 3, autonomous: 4
};

export function cappedAutonomy(configured: AutonomyLevel, cap?: AutonomyLevel | null): AutonomyLevel {
  return cap && autonomyRank[cap] < autonomyRank[configured] ? cap : configured;
}

export async function getAutonomySafety(env: Env, tenantId: string, blueprintId: string) {
  const row = await getSafetyRow(env, tenantId, blueprintId);
  if (!row) throw new Error("Process not found");
  const since = row.safety_cap_cleared_at ??
    new Date(Date.now() - row.fallback_window_hours * 60 * 60_000).toISOString();
  const reliability = await env.DB.prepare(`SELECT COUNT(*) terminal_runs,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed_runs
    FROM executions WHERE tenant_id=? AND blueprint_id=? AND started_at >= ?
      AND status IN ('completed','failed','blocked')`)
    .bind(tenantId, blueprintId, since).first<{ terminal_runs: number; completed_runs: number }>();
  const terminalRuns = Number(reliability?.terminal_runs ?? 0);
  const completedRuns = Number(reliability?.completed_runs ?? 0);
  return {
    state: serializeState(row),
    evidence: {
      terminalRuns,
      completedRuns,
      successRate: terminalRuns ? Math.round((completedRuns / terminalRuns) * 1000) / 10 : null,
      evaluatedSince: since,
    },
  };
}

export async function updateAutonomySafetyPolicy(env: Env, tenantId: string, actorId: string,
  blueprintId: string, input: {
    enabled?: boolean; minTerminalRuns?: number; successThreshold?: number;
    windowHours?: number; expectedRevision?: number;
  }) {
  const row = await getSafetyRow(env, tenantId, blueprintId);
  if (!row) throw new Error("Process not found");
  if (!Number.isInteger(input.expectedRevision)) throw new Error("Expected revision is required");
  const enabled = input.enabled ?? Boolean(row.fallback_enabled);
  const minRuns = Number(input.minTerminalRuns ?? row.fallback_min_terminal_runs);
  const threshold = Number(input.successThreshold ?? row.fallback_success_threshold);
  const hours = Number(input.windowHours ?? row.fallback_window_hours);
  if (!Number.isInteger(minRuns) || minRuns < 3 || minRuns > 100) {
    throw new Error("Minimum terminal runs must be 3–100");
  }
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    throw new Error("Success threshold must be 1–100%");
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new Error("Reliability window must be 1–168 hours");
  }
  if (!enabled && row.safety_autonomy_cap) {
    throw new Error("Clear the active safety fallback before disabling automatic fallback");
  }
  const result = await env.DB.prepare(`UPDATE agent_blueprints SET fallback_enabled=?,
    fallback_min_terminal_runs=?, fallback_success_threshold=?, fallback_window_hours=?,
    safety_cap_revision=safety_cap_revision+1, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND safety_cap_revision=?`)
    .bind(enabled ? 1 : 0, minRuns, threshold, hours, blueprintId, tenantId, input.expectedRevision).run();
  if (result.meta.changes !== 1) throw new Error("Fallback policy changed; reload before saving");
  await audit(env, tenantId, actorId, "autonomy.fallback_policy_updated", blueprintId, {
    enabled, minTerminalRuns: minRuns, successThreshold: threshold, windowHours: hours
  });
  return getAutonomySafety(env, tenantId, blueprintId);
}

export async function clearAutonomySafetyCap(env: Env, tenantId: string, actorId: string,
  blueprintId: string, input: { reason?: string; expectedRevision?: number }) {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10 || reason.length > 500) {
    throw new Error("Clearance reason must be 10–500 characters");
  }
  if (!Number.isInteger(input.expectedRevision)) throw new Error("Expected revision is required");
  const row = await getSafetyRow(env, tenantId, blueprintId);
  if (!row?.safety_autonomy_cap) throw new Error("No active safety fallback exists");
  const result = await env.DB.prepare(`UPDATE agent_blueprints SET safety_autonomy_cap=NULL,
    safety_cap_reason=NULL, safety_cap_trigger=NULL, safety_cap_evidence_id=NULL,
    safety_cap_triggered_at=NULL, safety_cap_cleared_at=CURRENT_TIMESTAMP,
    safety_cap_revision=safety_cap_revision+1, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND safety_cap_revision=? AND safety_autonomy_cap IS NOT NULL`)
    .bind(blueprintId, tenantId, input.expectedRevision).run();
  if (result.meta.changes !== 1) throw new Error("Fallback state changed; reload before clearing");
  await audit(env, tenantId, actorId, "autonomy.safety_fallback_cleared", blueprintId, {
    priorCap: row.safety_autonomy_cap, trigger: row.safety_cap_trigger,
    evidenceId: row.safety_cap_evidence_id, reason
  });
  return getAutonomySafety(env, tenantId, blueprintId);
}

export async function applyAutonomySafetyCap(env: Env, tenantId: string, blueprintId: string,
  cap: AutonomyLevel, trigger: SafetyTrigger, evidenceId: string, reason: string) {
  const row = await getSafetyRow(env, tenantId, blueprintId);
  if (!row || !row.fallback_enabled) return false;
  if (autonomyRank[cap] >= autonomyRank[row.autonomy]) return false;
  if (row.safety_autonomy_cap && autonomyRank[row.safety_autonomy_cap] <= autonomyRank[cap]) return false;
  const result = await env.DB.prepare(`UPDATE agent_blueprints SET safety_autonomy_cap=?,
    safety_cap_reason=?, safety_cap_trigger=?, safety_cap_evidence_id=?,
    safety_cap_triggered_at=CURRENT_TIMESTAMP, safety_cap_revision=safety_cap_revision+1,
    updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND fallback_enabled=1
      AND (safety_autonomy_cap IS NULL OR CASE safety_autonomy_cap
        WHEN 'observe' THEN 0 WHEN 'suggest' THEN 1 WHEN 'approve' THEN 2
        WHEN 'guarded' THEN 3 ELSE 4 END > ?)`)
    .bind(cap, reason.slice(0, 500), trigger, evidenceId, blueprintId, tenantId, autonomyRank[cap]).run();
  if (result.meta.changes !== 1) return false;
  await audit(env, tenantId, "system", "autonomy.safety_fallback_applied", blueprintId, {
    cap, trigger, evidenceId
  });
  try {
    await emitNotification(env, tenantId, {
      eventType: "incident.critical",
      title: `Automatic autonomy fallback · ${row.name}`,
      detail: `${reason} Effective autonomy is capped at ${cap} until an owner reviews and clears the fallback.`,
      targetType: "process", targetId: blueprintId
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "autonomy_fallback_notification_failed", blueprintId, error: String(error) }));
  }
  return true;
}

export async function evaluateAllAutonomySafety(env: Env, now = new Date()) {
  const { results } = await env.DB.prepare(`SELECT id, tenant_id, fallback_min_terminal_runs,
    fallback_success_threshold, fallback_window_hours, safety_cap_cleared_at
    FROM agent_blueprints WHERE fallback_enabled=1 AND status IN ('testing','active')
      AND autonomy IN ('guarded','autonomous') LIMIT 200`).all<{
    id: string; tenant_id: string; fallback_min_terminal_runs: number;
    fallback_success_threshold: number; fallback_window_hours: number; safety_cap_cleared_at: string | null;
  }>();
  let applied = 0;
  for (const process of results) {
    const windowStart = new Date(now.getTime() - Number(process.fallback_window_hours) * 60 * 60_000);
    const clearedAt = process.safety_cap_cleared_at ? new Date(process.safety_cap_cleared_at) : null;
    const since = clearedAt && clearedAt > windowStart ? clearedAt : windowStart;
    const evidence = await env.DB.prepare(`SELECT COUNT(*) terminal_runs,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed_runs
      FROM executions WHERE tenant_id=? AND blueprint_id=? AND started_at >= ?
        AND status IN ('completed','failed','blocked')`)
      .bind(process.tenant_id, process.id, since.toISOString())
      .first<{ terminal_runs: number; completed_runs: number }>();
    const terminal = Number(evidence?.terminal_runs ?? 0);
    const completed = Number(evidence?.completed_runs ?? 0);
    const successRate = terminal ? (completed / terminal) * 100 : 100;
    if (terminal >= Number(process.fallback_min_terminal_runs) &&
      successRate < Number(process.fallback_success_threshold)) {
      const changed = await applyAutonomySafetyCap(env, process.tenant_id, process.id, "approve",
        "reliability", `${since.toISOString()}:${terminal}`,
        `${completed} of ${terminal} terminal runs completed in the configured window (${successRate.toFixed(1)}%).`);
      if (changed) applied += 1;
    }
  }
  return { evaluated: results.length, applied };
}

async function getSafetyRow(env: Env, tenantId: string, blueprintId: string) {
  return env.DB.prepare(`SELECT id, tenant_id, name, autonomy, fallback_enabled, fallback_min_terminal_runs,
    fallback_success_threshold, fallback_window_hours, safety_autonomy_cap, safety_cap_reason,
    safety_cap_trigger, safety_cap_evidence_id, safety_cap_triggered_at, safety_cap_cleared_at,
    safety_cap_revision FROM agent_blueprints WHERE id=? AND tenant_id=?`)
    .bind(blueprintId, tenantId).first<SafetyRow>();
}

function serializeState(row: SafetyRow): AutonomySafetyState {
  return {
    enabled: Boolean(row.fallback_enabled),
    minTerminalRuns: Number(row.fallback_min_terminal_runs),
    successThreshold: Number(row.fallback_success_threshold),
    windowHours: Number(row.fallback_window_hours),
    cap: row.safety_autonomy_cap,
    reason: row.safety_cap_reason,
    trigger: row.safety_cap_trigger,
    evidenceId: row.safety_cap_evidence_id,
    triggeredAt: row.safety_cap_triggered_at,
    clearedAt: row.safety_cap_cleared_at,
    revision: Number(row.safety_cap_revision),
  };
}

async function audit(env: Env, tenantId: string, actorId: string, eventType: string,
  blueprintId: string, detail: unknown) {
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'process', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, blueprintId, JSON.stringify(detail)).run();
}
