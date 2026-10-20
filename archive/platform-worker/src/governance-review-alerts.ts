import type { Env } from "./types";
import { emitNotification } from "./notifications";

interface ReviewCandidate {
  tenant_id: string;
  review_key: string;
  name: string;
  next_due_at: string;
}

export async function emitGovernanceReviewAlerts(env: Env, now = new Date()) {
  const dueThrough = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(`SELECT r.tenant_id, r.review_key, r.name, r.next_due_at
    FROM tenant_governance_reviews r
    WHERE datetime(r.next_due_at) <= datetime(?)
      AND EXISTS (SELECT 1 FROM notification_policies p
        WHERE p.tenant_id=r.tenant_id AND p.event_type='governance.review_due' AND p.enabled=1)
    ORDER BY datetime(r.next_due_at), r.tenant_id, r.review_key LIMIT 100`)
    .bind(dueThrough).all<ReviewCandidate>();
  let emitted = 0;
  let deduplicated = 0;
  for (const review of results) {
    const due = new Date(normalizeDate(review.next_due_at));
    const stage = due.getTime() < now.getTime() ? "overdue" : "due";
    const claim = await env.DB.prepare(`INSERT OR IGNORE INTO governance_review_alert_receipts
      (tenant_id, review_key, due_at, stage) VALUES (?, ?, ?, ?)`)
      .bind(review.tenant_id, review.review_key, review.next_due_at, stage).run();
    if (claim.meta.changes !== 1) { deduplicated += 1; continue; }
    try {
      const days = Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 86_400_000));
      const ids = await emitNotification(env, review.tenant_id, {
        eventType: "governance.review_due",
        title: stage === "overdue"
          ? `Governance review overdue · ${safeName(review.name)}`
          : `Governance review due in ${days} day${days === 1 ? "" : "s"} · ${safeName(review.name)}`,
        detail: stage === "overdue"
          ? `This customer governance review passed its ${dateLabel(due)} due date. An owner or administrator must record current evidence and follow-up notes.`
          : `Complete this customer governance review by ${dateLabel(due)} with an evidence reference and accountable notes.`,
        targetType: "governance_review",
        targetId: review.review_key,
      });
      if (!ids.length) {
        await releaseClaim(env, review, stage);
        continue;
      }
      await env.DB.prepare(`UPDATE governance_review_alert_receipts SET notification_event_count=?
        WHERE tenant_id=? AND review_key=? AND due_at=? AND stage=?`)
        .bind(ids.length, review.tenant_id, review.review_key, review.next_due_at, stage).run();
      emitted += ids.length;
    } catch (error) {
      await releaseClaim(env, review, stage);
      throw error;
    }
  }
  return { considered: results.length, emitted, deduplicated, capped: results.length === 100 };
}

async function releaseClaim(env: Env, review: ReviewCandidate, stage: string) {
  await env.DB.prepare(`DELETE FROM governance_review_alert_receipts
    WHERE tenant_id=? AND review_key=? AND due_at=? AND stage=?`)
    .bind(review.tenant_id, review.review_key, review.next_due_at, stage).run();
}

function normalizeDate(value: string) {
  return value.endsWith("Z") || value.includes("+") ? value : `${value.replace(" ", "T")}Z`;
}
function dateLabel(value: Date) { return value.toISOString().slice(0, 10); }
function safeName(value: string) { return String(value).replace(/[\r\n\t]/g, " ").slice(0, 100); }
