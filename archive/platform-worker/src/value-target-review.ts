import { emitNotification } from "./notifications";
import type { Env } from "./types";

interface ReviewCandidate {
  tenant_id: string;
  blueprint_id: string;
  process_name: string;
  review_due_at: string;
  revision: number;
}

export async function emitValueTargetReviewAlerts(env: Env, now = new Date()) {
  const dueThrough = new Date(now.getTime() + 7 * 86_400_000);
  const { results } = await env.DB.prepare(`SELECT t.tenant_id, t.blueprint_id, b.name process_name,
      t.review_due_at, t.revision
    FROM process_value_targets t
    JOIN agent_blueprints b ON b.id=t.blueprint_id AND b.tenant_id=t.tenant_id
    WHERE datetime(t.review_due_at) <= datetime(?)
      AND b.status NOT IN ('retired')
      AND EXISTS (
        SELECT 1 FROM notification_policies p
        WHERE p.tenant_id=t.tenant_id AND p.event_type='value.target_review_due' AND p.enabled=1
      )
    ORDER BY datetime(t.review_due_at), t.tenant_id, t.blueprint_id
    LIMIT 100`).bind(dueThrough.toISOString()).all<ReviewCandidate>();
  let candidates = 0;
  let events = 0;
  for (const target of results) {
    candidates += 1;
    const overdue = new Date(normalizeDate(target.review_due_at)).getTime() <= now.getTime();
    const stage = overdue ? "overdue" : "due_soon";
    const targetId = `${target.blueprint_id}:r${target.revision}:${stage}`;
    const due = new Date(normalizeDate(target.review_due_at));
    const days = Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 86_400_000));
    const ids = await emitNotification(env, target.tenant_id, {
      eventType: "value.target_review_due",
      title: overdue
        ? `Value target review overdue · ${target.process_name}`
        : `Value target review due in ${days} day${days === 1 ? "" : "s"} · ${target.process_name}`,
      detail: overdue
        ? `The owner-approved 30-day target passed its ${dateLabel(due)} review date. Renew the target evidence before publishing another release.`
        : `Review the owner-approved 30-day target by ${dateLabel(due)}. Confirm the outcome, thresholds, rationale, and evidence before it expires.`,
      targetType: "value_target",
      targetId
    });
    events += ids.length;
  }
  return { scanned: results.length, candidates, events, capped: results.length === 100 };
}

function normalizeDate(value: string) {
  return value.endsWith("Z") || value.includes("+") ? value : `${value.replace(" ", "T")}Z`;
}

function dateLabel(value: Date) {
  return value.toISOString().slice(0, 10);
}
