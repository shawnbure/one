import type { Env } from "./types";

export const governanceReviewDefaults = [
  ["privacy_architecture", "Privacy and architecture",
    "Confirm data flows, storage, retention, external destinations, and customer ownership."],
  ["model_inventory", "AI model inventory",
    "Confirm every approved and deployed model remains authorized for organizational use."],
  ["access_roles", "Access and role review",
    "Confirm active members, service principals, delegated approvers, and least privilege."],
  ["incident_recovery", "Incident and recovery readiness",
    "Review incidents, recovery ownership, maintenance evidence, and the customer runbook."],
] as const;

export async function provisionGovernanceReviews(env: Env, tenantId: string) {
  await env.DB.batch(governanceReviewDefaults.map(([key, name, description]) =>
    env.DB.prepare(`INSERT OR IGNORE INTO tenant_governance_reviews
      (tenant_id, review_key, name, description, cadence_days, next_due_at)
      VALUES (?, ?, ?, ?, 90, datetime(CURRENT_TIMESTAMP, '+90 days'))`)
      .bind(tenantId, key, name, description)));
}

export async function completeGovernanceReview(env: Env, tenantId: string, actorId: string,
  reviewKey: string, input: { evidenceReference?: string; notes?: string }) {
  const evidenceReference = input.evidenceReference?.trim() ?? "";
  const notes = input.notes?.trim() ?? "";
  if (evidenceReference.length < 5 || evidenceReference.length > 300) {
    throw new Error("Evidence reference must be between 5 and 300 characters");
  }
  if (notes.length < 10 || notes.length > 1000) {
    throw new Error("Review notes must be between 10 and 1,000 characters");
  }
  const review = await env.DB.prepare(`SELECT review_key, cadence_days FROM tenant_governance_reviews
    WHERE tenant_id=? AND review_key=?`).bind(tenantId, reviewKey)
    .first<{ review_key: string; cadence_days: number }>();
  if (!review) throw new Error("Governance review was not found");
  const result = await env.DB.prepare(`UPDATE tenant_governance_reviews
    SET last_completed_at=CURRENT_TIMESTAMP, last_completed_by=?, evidence_reference=?,
      completion_notes=?, next_due_at=datetime(CURRENT_TIMESTAMP, '+' || cadence_days || ' days'),
      updated_at=CURRENT_TIMESTAMP
    WHERE tenant_id=? AND review_key=?`).bind(actorId, evidenceReference, notes, tenantId, reviewKey).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error("Governance review could not be completed");
  return { reviewKey, evidenceReference, nextDueInDays: Number(review.cadence_days) };
}
