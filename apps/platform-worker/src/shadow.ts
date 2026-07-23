import type { Env } from "./types";
import { applyDlp, DlpBlockedError } from "./dlp";
import { applyAutonomySafetyCap } from "./autonomy-safety";

export type ShadowVerdict = "match" | "partial" | "miss" | "unsafe";

export interface ShadowReview {
  id: string;
  execution_id: string;
  blueprint_id: string;
  process_name?: string;
  status: "pending" | "reviewed";
  verdict: ShadowVerdict | null;
  actual_outcome: string | null;
  note: string | null;
  reviewed_by: string | null;
  reviewer_name?: string | null;
  reviewed_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export class ShadowReviewConflict extends Error {}

export async function recordShadowReview(
  env: Env, tenantId: string, executionId: string, blueprintId: string
) {
  await env.DB.prepare(`INSERT OR IGNORE INTO execution_shadow_reviews
    (id, tenant_id, execution_id, blueprint_id) VALUES (?, ?, ?, ?)`)
    .bind(`shadow-${executionId}`, tenantId, executionId, blueprintId).run();
}

export async function getShadowReview(env: Env, tenantId: string, executionId: string) {
  return env.DB.prepare(`SELECT r.*, m.display_name reviewer_name
    FROM execution_shadow_reviews r
    LEFT JOIN tenant_members m ON m.id=r.reviewed_by AND m.tenant_id=r.tenant_id
    WHERE r.tenant_id=? AND r.execution_id=? LIMIT 1`)
    .bind(tenantId, executionId).first<ShadowReview>();
}

export async function listShadowReviews(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare(`SELECT r.*, b.name process_name,
    m.display_name reviewer_name
    FROM execution_shadow_reviews r
    JOIN agent_blueprints b ON b.id=r.blueprint_id AND b.tenant_id=r.tenant_id
    LEFT JOIN tenant_members m ON m.id=r.reviewed_by AND m.tenant_id=r.tenant_id
    WHERE r.tenant_id=? ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
    LIMIT 100`).bind(tenantId).all<ShadowReview>();
  return results;
}

export async function reviewShadowExecution(env: Env, tenantId: string, actorId: string,
  executionId: string, input: {
    expectedRevision?: number; verdict?: string; actualOutcome?: string; note?: string;
  }) {
  if (!Number.isInteger(input.expectedRevision)) throw new Error("Expected revision is required");
  if (!["match", "partial", "miss", "unsafe"].includes(input.verdict ?? "")) {
    throw new Error("A valid shadow verdict is required");
  }
  const actualOutcome = input.actualOutcome?.trim() ?? "";
  const note = input.note?.trim() ?? "";
  if (!actualOutcome || actualOutcome.length > 2000) {
    throw new Error("Actual outcome must be between 1 and 2,000 characters");
  }
  if (note.length > 1000) throw new Error("Review note must be 1,000 characters or fewer");
  const review = await env.DB.prepare(`SELECT r.id, r.blueprint_id, r.revision
    FROM execution_shadow_reviews r JOIN executions e
      ON e.id=r.execution_id AND e.tenant_id=r.tenant_id
    WHERE r.tenant_id=? AND r.execution_id=? AND e.autonomy_disposition='shadowed' LIMIT 1`)
    .bind(tenantId, executionId).first<{ id: string; blueprint_id: string; revision: number }>();
  if (!review) throw new Error("Shadow review not found");
  const protectedOutcome = await applyDlp(env, tenantId, actualOutcome, {
    direction: "input", stage: "shadow_actual_outcome", executionId, blueprintId: review.blueprint_id
  });
  if (protectedOutcome.blocked) throw new DlpBlockedError(protectedOutcome.blockedDetectors);
  const result = await env.DB.prepare(`UPDATE execution_shadow_reviews
    SET status='reviewed', verdict=?, actual_outcome=?, note=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP,
      revision=revision+1, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND revision=?`)
    .bind(input.verdict, protectedOutcome.safeText, note || null, actorId, review.id, tenantId,
      input.expectedRevision).run();
  if (result.meta.changes !== 1) throw new ShadowReviewConflict("Shadow review changed; reload before saving");
  if (input.verdict === "unsafe") {
    await applyAutonomySafetyCap(env, tenantId, review.blueprint_id, "suggest", "unsafe_shadow",
      review.id, "An authorized reviewer marked a shadow-mode proposal unsafe.");
  }
  return getShadowReview(env, tenantId, executionId);
}
