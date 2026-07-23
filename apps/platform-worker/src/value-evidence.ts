import type { Env } from "./types";
import { applyDlp, DlpBlockedError } from "./dlp";

export async function recordValueMeasurement(env: Env, tenantId: string, actorId: string, input: {
  blueprintId?: string; periodStart?: string; periodEnd?: string; itemsProcessed?: number;
  actualHumanMinutes?: number; averageCycleMinutes?: number | null; overrideCount?: number;
  failureCount?: number; evidenceReference?: string; note?: string;
}) {
  const blueprintId = input.blueprintId?.trim() ?? "";
  const periodStart = dateOnly(input.periodStart);
  const periodEnd = dateOnly(input.periodEnd);
  const items = boundedInteger(input.itemsProcessed, 1, 1_000_000);
  const actualMinutes = boundedNumber(input.actualHumanMinutes, 0, 100_000_000);
  const averageCycle = input.averageCycleMinutes === null || input.averageCycleMinutes === undefined
    ? null : boundedNumber(input.averageCycleMinutes, 0, 1_000_000);
  const overrides = boundedInteger(input.overrideCount ?? 0, 0, items);
  const failures = boundedInteger(input.failureCount ?? 0, 0, items);
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T23:59:59Z`);
  const today = new Date();
  if (!blueprintId || start > end || end > new Date(today.getTime() + 86_400_000) ||
      start < new Date(today.getTime() - 2 * 366 * 86_400_000) ||
      end.getTime() - start.getTime() > 366 * 86_400_000) {
    throw new Error("Select a process and a valid evidence period no longer than one year and no older than two years");
  }
  const rawEvidence = input.evidenceReference?.trim() ?? "";
  const rawNote = input.note?.trim() ?? "";
  if (rawEvidence.length < 5 || rawEvidence.length > 300 || rawNote.length > 1000) {
    throw new Error("Evidence reference must be 5–300 characters and note at most 1,000 characters");
  }
  const protectedText = await applyDlp(env, tenantId, JSON.stringify({
    evidenceReference: rawEvidence, note: rawNote
  }), { direction: "input", stage: "value_measurement", blueprintId });
  if (protectedText.blocked) throw new DlpBlockedError(protectedText.blockedDetectors);
  const safe = JSON.parse(protectedText.safeText) as { evidenceReference: string; note: string };
  const baseline = await env.DB.prepare(`SELECT d.minutes_per_item, d.hourly_cost, b.name
    FROM process_discovery d JOIN agent_blueprints b ON b.id=d.blueprint_id AND b.tenant_id=d.tenant_id
    WHERE d.tenant_id=? AND d.blueprint_id=? ORDER BY d.created_at DESC LIMIT 1`)
    .bind(tenantId, blueprintId).first<{ minutes_per_item: number; hourly_cost: number; name: string }>();
  if (!baseline) throw new Error("Process must have a same-tenant discovery baseline before value can be measured");
  const savedMinutes = round(Math.max(0, Number(baseline.minutes_per_item) * items - actualMinutes), 2);
  const estimatedValue = round(savedMinutes / 60 * Number(baseline.hourly_cost), 2);
  const id = `value-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO business_value_measurements
      (id, tenant_id, blueprint_id, period_start, period_end, items_processed,
       actual_human_minutes, average_cycle_minutes, human_minutes_saved, estimated_value,
       override_count, failure_count, evidence_reference, note, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, tenantId, blueprintId, periodStart, periodEnd, items, actualMinutes,
        averageCycle, savedMinutes, estimatedValue, overrides, failures,
        safe.evidenceReference, safe.note || null, actorId),
    env.DB.prepare(`INSERT INTO audit_events
      (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
      VALUES (?, ?, ?, 'value.measurement_recorded', 'value_measurement', ?, ?)`)
      .bind(crypto.randomUUID(), tenantId, actorId, id, JSON.stringify({
        blueprintId, periodStart, periodEnd, itemsProcessed: items,
        humanMinutesSaved: savedMinutes, estimatedValue, overrideCount: overrides, failureCount: failures
      }))
  ]);
  return { id, processName: baseline.name, humanMinutesSaved: savedMinutes, estimatedValue, status: "active" };
}

export async function voidValueMeasurement(env: Env, tenantId: string, actorId: string,
  id: string, reason?: string, expectedRevision?: number) {
  const rawReason = reason?.trim() ?? "";
  if (rawReason.length < 10 || rawReason.length > 500 || !Number.isInteger(expectedRevision)) {
    throw new Error("A 10–500 character correction reason and expected revision are required");
  }
  const protectedReason = await applyDlp(env, tenantId, rawReason,
    { direction: "input", stage: "value_measurement_void" });
  if (protectedReason.blocked) throw new DlpBlockedError(protectedReason.blockedDetectors);
  const result = await env.DB.prepare(`UPDATE business_value_measurements
    SET status='void', void_reason=?, voided_by=?, voided_at=CURRENT_TIMESTAMP, revision=revision+1
    WHERE id=? AND tenant_id=? AND status='active' AND revision=?`)
    .bind(protectedReason.safeText, actorId, id, tenantId, expectedRevision).run();
  if (result.meta.changes !== 1) throw new Error("Value measurement changed or was already voided; reload before correcting");
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, 'value.measurement_voided', 'value_measurement', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, id, JSON.stringify({ reason: protectedReason.safeText })).run();
  return { id, status: "void" };
}

function dateOnly(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf())) {
    throw new Error("Evidence period start and end dates are required");
  }
  return value;
}
function boundedInteger(value: number | undefined, min: number, max: number) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`Whole-number value must be ${min}–${max}`);
  return Number(value);
}
function boundedNumber(value: number | undefined, min: number, max: number) {
  if (!Number.isFinite(value) || Number(value) < min || Number(value) > max) throw new Error(`Numeric value must be ${min}–${max}`);
  return Number(value);
}
function round(value: number, digits: number) {
  const factor = 10 ** digits; return Math.round(value * factor) / factor;
}
