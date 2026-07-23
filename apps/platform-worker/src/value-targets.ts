import type { Env } from "./types";
import { applyDlp, DlpBlockedError } from "./dlp";

export class ValueTargetConflict extends Error {}

export async function updateValueTarget(env: Env, tenantId: string, actorId: string, blueprintId: string, input: {
  targetItems?: number; targetHumanMinutesSaved?: number; targetValue?: number;
  maximumOverridePercent?: number; maximumFailurePercent?: number; reviewDueAt?: string;
  rationale?: string; evidenceReference?: string; expectedRevision?: number;
}) {
  const targetItems = integer(input.targetItems, 1, 1_000_000, "Target items");
  const targetMinutes = number(input.targetHumanMinutesSaved, 0, 100_000_000, "Target effort returned");
  const targetValue = number(input.targetValue, 0, 1_000_000_000, "Target value");
  const maxOverrides = number(input.maximumOverridePercent, 0, 100, "Maximum override percent");
  const maxFailures = number(input.maximumFailurePercent, 0, 100, "Maximum failure percent");
  const reviewDue = new Date(input.reviewDueAt ?? "");
  const rationale = input.rationale?.trim() ?? "";
  const evidence = input.evidenceReference?.trim() ?? "";
  if (Number.isNaN(reviewDue.valueOf()) || reviewDue <= new Date() ||
      reviewDue > new Date(Date.now() + 2 * 366 * 86_400_000) ||
      rationale.length < 20 || rationale.length > 1000 || evidence.length < 5 || evidence.length > 300 ||
      !Number.isInteger(input.expectedRevision)) {
    throw new Error("Provide a future review within two years, a 20–1,000 character rationale, evidence reference, and expected revision");
  }
  const protectedText = await applyDlp(env, tenantId, JSON.stringify({ rationale, evidence }),
    { direction: "input", stage: "value_target", blueprintId });
  if (protectedText.blocked) throw new DlpBlockedError(protectedText.blockedDetectors);
  const safe = JSON.parse(protectedText.safeText) as { rationale: string; evidence: string };
  const process = await env.DB.prepare(`SELECT b.id FROM agent_blueprints b
    JOIN process_discovery d ON d.blueprint_id=b.id AND d.tenant_id=b.tenant_id
    WHERE b.id=? AND b.tenant_id=? LIMIT 1`).bind(blueprintId, tenantId).first();
  if (!process) throw new Error("Process must have a same-tenant discovery baseline before a target can be set");
  const existing = await env.DB.prepare(`SELECT revision FROM process_value_targets
    WHERE tenant_id=? AND blueprint_id=?`).bind(tenantId, blueprintId).first<{ revision: number }>();
  if (existing && Number(existing.revision) !== input.expectedRevision) throw new ValueTargetConflict("Value target changed; reload before saving");
  if (!existing && input.expectedRevision !== 0) throw new ValueTargetConflict("Expected revision 0 for a new value target");
  const result = await env.DB.prepare(`INSERT INTO process_value_targets
    (tenant_id, blueprint_id, target_items, target_human_minutes_saved, target_value,
     maximum_override_percent, maximum_failure_percent, review_due_at, rationale,
     evidence_reference, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, blueprint_id) DO UPDATE SET target_items=excluded.target_items,
      target_human_minutes_saved=excluded.target_human_minutes_saved, target_value=excluded.target_value,
      maximum_override_percent=excluded.maximum_override_percent,
      maximum_failure_percent=excluded.maximum_failure_percent,
      review_due_at=excluded.review_due_at, rationale=excluded.rationale,
      evidence_reference=excluded.evidence_reference, revision=process_value_targets.revision+1,
      updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP
    WHERE process_value_targets.revision=?`)
    .bind(tenantId, blueprintId, targetItems, targetMinutes, targetValue, maxOverrides, maxFailures,
      reviewDue.toISOString(), safe.rationale, safe.evidence, actorId, input.expectedRevision).run();
  if (result.meta.changes !== 1) throw new ValueTargetConflict("Value target changed; reload before saving");
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, 'value.target_updated', 'process', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, blueprintId, JSON.stringify({
      targetItems, targetHumanMinutesSaved: targetMinutes, targetValue,
      maximumOverridePercent: maxOverrides, maximumFailurePercent: maxFailures,
      reviewDueAt: reviewDue.toISOString()
    })).run();
  return { blueprintId, targetItems, targetHumanMinutesSaved: targetMinutes, targetValue,
    maximumOverridePercent: maxOverrides, maximumFailurePercent: maxFailures,
    reviewDueAt: reviewDue.toISOString(), revision: existing ? existing.revision + 1 : 0 };
}

function integer(value: number | undefined, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  return Number(value);
}
function number(value: number | undefined, min: number, max: number, label: string) {
  if (!Number.isFinite(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} must be from ${min} to ${max}`);
  return Number(value);
}
