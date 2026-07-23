import { instanceKeyFor, type ExecutionProfile, type ExecutionRequest, type QueueJob } from "@workrr/contracts";
import { assertAsyncExecutionAdmission, sanitizeAsyncExecutionInput } from "./execution";
import type { Env } from "./types";

type Cadence = "hourly" | "daily" | "weekly";
interface ScheduleRow {
  id: string;
  tenant_id: string;
  blueprint_id: string;
  cadence: Cadence;
  time_utc: string | null;
  weekday_utc: number | null;
  input_text: string;
  identity_key: string | null;
  execution_profile: string;
  next_run_at: string;
}

export async function listSchedules(env: Env, tenantId: string, blueprintId?: string) {
  const filter = blueprintId ? " AND s.blueprint_id = ?" : "";
  const bindings = blueprintId ? [tenantId, blueprintId] : [tenantId];
  const [schedules, dispatches] = await Promise.all([
    env.DB.prepare(`SELECT s.id, s.blueprint_id, b.name process_name, b.execution_profile, s.name, s.cadence,
      s.time_utc, s.weekday_utc, s.identity_key, s.status, s.next_run_at, s.last_dispatched_at,
      s.last_execution_id, s.dispatch_count, s.last_error, s.created_at, s.updated_at
      FROM process_schedules s JOIN agent_blueprints b ON b.id = s.blueprint_id AND b.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?${filter} ORDER BY s.status, s.next_run_at`).bind(...bindings).all(),
    env.DB.prepare(`SELECT d.id, d.schedule_id, d.blueprint_id, d.execution_id, d.scheduled_for, d.status,
      d.error, d.created_at, d.completed_at FROM schedule_dispatches d
      WHERE d.tenant_id = ? ORDER BY d.created_at DESC LIMIT 50`).bind(tenantId).all()
  ]);
  return { schedules: schedules.results, dispatches: dispatches.results };
}

export async function createSchedule(env: Env, tenantId: string, actorId: string, blueprintId: string, input: {
  name?: unknown; cadence?: unknown; timeUtc?: unknown; weekdayUtc?: unknown; input?: unknown; identityKey?: unknown;
}) {
  const blueprint = await env.DB.prepare(`SELECT id, execution_profile, status FROM agent_blueprints
    WHERE id = ? AND tenant_id = ?`).bind(blueprintId, tenantId)
    .first<{ id: string; execution_profile: string; status: string }>();
  if (!blueprint) throw new Error("Process not found");
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
  const inputText = typeof input.input === "string" ? input.input.trim().slice(0, 20_000) : "";
  const cadence = input.cadence;
  if (!name || !inputText || !["hourly", "daily", "weekly"].includes(String(cadence))) {
    throw new Error("Name, process input, and a valid cadence are required");
  }
  const timeUtc = cadence === "hourly" ? null : normalizeTime(input.timeUtc);
  const weekdayUtc = cadence === "weekly" ? normalizeWeekday(input.weekdayUtc) : null;
  const identityKey = typeof input.identityKey === "string" ? input.identityKey.trim().slice(0, 200) : "";
  const request = scheduledRequest(blueprintId, blueprint.execution_profile, inputText, identityKey, "validation");
  instanceKeyFor(blueprint.execution_profile as ExecutionProfile, request);
  const count = await env.DB.prepare("SELECT COUNT(*) count FROM process_schedules WHERE tenant_id = ?")
    .bind(tenantId).first<{ count: number }>();
  if (Number(count?.count) >= 50) throw new Error("Organizations support up to 50 recurring schedules");
  const id = crypto.randomUUID();
  const nextRunAt = nextOccurrence(cadence as Cadence, timeUtc, weekdayUtc, new Date());
  await env.DB.prepare(`INSERT INTO process_schedules
    (id, tenant_id, blueprint_id, name, cadence, time_utc, weekday_utc, input_text, identity_key,
     status, next_run_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .bind(id, tenantId, blueprintId, name, cadence, timeUtc, weekdayUtc, inputText, identityKey || null,
      nextRunAt, actorId).run();
  return { id, status: "active", nextRunAt };
}

export async function updateSchedule(env: Env, tenantId: string, scheduleId: string, input: {
  status?: unknown; cadence?: unknown; timeUtc?: unknown; weekdayUtc?: unknown;
}) {
  const current = await env.DB.prepare(`SELECT cadence, time_utc, weekday_utc FROM process_schedules
    WHERE id = ? AND tenant_id = ?`).bind(scheduleId, tenantId)
    .first<{ cadence: Cadence; time_utc: string | null; weekday_utc: number | null }>();
  if (!current) throw new Error("Schedule not found");
  const status = typeof input.status === "string" ? input.status : undefined;
  if (status && !["active", "paused"].includes(status)) throw new Error("Schedule status is invalid");
  const cadence = input.cadence === undefined ? current.cadence : String(input.cadence) as Cadence;
  if (!["hourly", "daily", "weekly"].includes(cadence)) throw new Error("Schedule cadence is invalid");
  const timeUtc = cadence === "hourly" ? null :
    input.timeUtc === undefined ? current.time_utc ?? "09:00" : normalizeTime(input.timeUtc);
  const weekdayUtc = cadence === "weekly" ?
    input.weekdayUtc === undefined ? current.weekday_utc ?? 1 : normalizeWeekday(input.weekdayUtc) : null;
  const nextRunAt = nextOccurrence(cadence, timeUtc, weekdayUtc, new Date());
  await env.DB.prepare(`UPDATE process_schedules SET status = COALESCE(?, status), cadence = ?, time_utc = ?,
    weekday_utc = ?, next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`)
    .bind(status ?? null, cadence, timeUtc, weekdayUtc, nextRunAt, scheduleId, tenantId).run();
  return { id: scheduleId, status, cadence, nextRunAt };
}

export async function dispatchScheduleNow(env: Env, tenantId: string, scheduleId: string) {
  const schedule = await scheduleById(env, tenantId, scheduleId);
  if (!schedule) throw new Error("Schedule not found");
  return dispatchSchedule(env, schedule, new Date().toISOString(), false);
}

export async function dispatchDueSchedules(env: Env, now = new Date()) {
  const due = await env.DB.prepare(`SELECT s.id, s.tenant_id, s.blueprint_id, s.cadence, s.time_utc,
    s.weekday_utc, s.input_text, s.identity_key, s.next_run_at, b.execution_profile
    FROM process_schedules s JOIN agent_blueprints b ON b.id = s.blueprint_id AND b.tenant_id = s.tenant_id
    WHERE s.status = 'active' AND s.next_run_at <= ? ORDER BY s.next_run_at LIMIT 50`)
    .bind(now.toISOString()).all<ScheduleRow>();
  const results = [];
  for (const schedule of due.results) {
    const nextRunAt = nextOccurrence(schedule.cadence, schedule.time_utc, schedule.weekday_utc, now);
    const claim = await env.DB.prepare(`UPDATE process_schedules SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ? AND status = 'active' AND next_run_at = ?`)
      .bind(nextRunAt, schedule.id, schedule.tenant_id, schedule.next_run_at).run();
    if (claim.meta.changes !== 1) continue;
    results.push(await dispatchSchedule(env, schedule, schedule.next_run_at, true));
  }
  return results;
}

async function dispatchSchedule(env: Env, schedule: ScheduleRow, scheduledFor: string, claimed: boolean) {
  const executionId = crypto.randomUUID();
  const dispatchId = crypto.randomUUID();
  try {
    const admission = await assertAsyncExecutionAdmission(env, schedule.tenant_id, schedule.blueprint_id);
    if (admission.deferred) {
      await recordDispatch(env, schedule, dispatchId, executionId, scheduledFor, "deferred", "Process is paused");
      return { scheduleId: schedule.id, executionId, status: "deferred" };
    }
    const raw = scheduledRequest(schedule.blueprint_id, schedule.execution_profile, schedule.input_text,
      schedule.identity_key ?? "", executionId);
    const request = await sanitizeAsyncExecutionInput(env, schedule.tenant_id, raw, executionId);
    const job: QueueJob = { ...request, executionId, attempt: 0, tenantId: schedule.tenant_id };
    await env.PROCESS_QUEUE.send(job, { contentType: "json" });
    await recordDispatch(env, schedule, dispatchId, executionId, scheduledFor, "queued", null);
    return { scheduleId: schedule.id, executionId, status: "queued" };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await recordDispatch(env, schedule, dispatchId, executionId, scheduledFor, "failed", message);
    if (!claimed) throw error;
    return { scheduleId: schedule.id, executionId, status: "failed", error: message };
  }
}

async function recordDispatch(env: Env, schedule: ScheduleRow, dispatchId: string, executionId: string,
  scheduledFor: string, status: "queued" | "deferred" | "failed", error: string | null) {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO schedule_dispatches
      (id, tenant_id, schedule_id, blueprint_id, execution_id, scheduled_for, status, error, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(dispatchId, schedule.tenant_id, schedule.id,
        schedule.blueprint_id, executionId, scheduledFor, status, error, status === "queued" ? null : new Date().toISOString()),
    env.DB.prepare(`UPDATE process_schedules SET last_dispatched_at = CURRENT_TIMESTAMP, last_execution_id = ?,
      dispatch_count = dispatch_count + 1, last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?`).bind(executionId, error, schedule.id, schedule.tenant_id)
  ]);
}

async function scheduleById(env: Env, tenantId: string, scheduleId: string) {
  return env.DB.prepare(`SELECT s.id, s.tenant_id, s.blueprint_id, s.cadence, s.time_utc, s.weekday_utc,
    s.input_text, s.identity_key, s.next_run_at, b.execution_profile
    FROM process_schedules s JOIN agent_blueprints b ON b.id = s.blueprint_id AND b.tenant_id = s.tenant_id
    WHERE s.id = ? AND s.tenant_id = ?`).bind(scheduleId, tenantId).first<ScheduleRow>();
}

function scheduledRequest(blueprintId: string, profile: string, input: string, identityKey: string,
  executionId: string): ExecutionRequest {
  const request: ExecutionRequest = { blueprintId, input,
    idempotencyKey: `schedule:${executionId}`, metadata: { trigger: "schedule" } };
  if (profile === "conversation") request.threadId = identityKey;
  if (profile === "consumer") request.consumerId = identityKey;
  if (profile === "entity") request.entityId = identityKey;
  if (profile === "shared_shard") request.shardKey = identityKey;
  return request;
}

function normalizeTime(value: unknown): string {
  const time = typeof value === "string" ? value.trim() : "";
  if (!/^(?:[01]\d|2[0-3]):00$/.test(time)) throw new Error("Daily and weekly schedules require an hourly UTC time");
  return time;
}

function normalizeWeekday(value: unknown): number {
  const weekday = Number(value);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("Weekly schedules require a UTC weekday");
  return weekday;
}

export function nextOccurrence(cadence: Cadence, timeUtc: string | null, weekdayUtc: number | null, after: Date): string {
  const next = new Date(after);
  next.setUTCMinutes(0, 0, 0);
  if (cadence === "hourly") {
    next.setUTCHours(next.getUTCHours() + 1);
    return next.toISOString();
  }
  const [hour] = (timeUtc ?? "09:00").split(":").map(Number);
  next.setUTCHours(hour ?? 9);
  if (next <= after) next.setUTCDate(next.getUTCDate() + 1);
  if (cadence === "weekly") {
    const target = weekdayUtc ?? 1;
    const days = (target - next.getUTCDay() + 7) % 7;
    next.setUTCDate(next.getUTCDate() + days);
    if (next <= after) next.setUTCDate(next.getUTCDate() + 7);
  }
  return next.toISOString();
}
