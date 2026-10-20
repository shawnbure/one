import type { Env } from "./types";

export async function decideProcessRelease(env: Env, tenantId: string, blueprintId: string,
  releaseId: string, actorId: string, input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Release review decision is required");
  const body = input as { decision?: string; evidence?: string };
  if (!["approved", "rejected"].includes(body.decision ?? "")) {
    throw new Error("Select approve or reject");
  }
  const evidence = String(body.evidence ?? "").trim().replace(/\s+/g, " ");
  if (evidence.length < 10 || evidence.length > 1000) {
    throw new Error("Release review evidence must be 10 to 1,000 characters");
  }
  const release = await env.DB.prepare(`SELECT r.id, r.status, r.checksum, r.created_by, r.version,
      b.risk_level
    FROM process_releases r JOIN agent_blueprints b ON b.id=r.blueprint_id AND b.tenant_id=r.tenant_id
    WHERE r.id=? AND r.tenant_id=? AND r.blueprint_id=?`)
    .bind(releaseId, tenantId, blueprintId).first<Record<string, unknown>>();
  if (!release) throw new Error("Process release not found");
  if (release.status !== "draft") throw new Error("Only a draft release can receive a governance decision");
  if (body.decision === "approved" && release.risk_level === "high" &&
      String(release.created_by) === actorId) {
    throw new Error("A different owner or administrator must approve a high-risk release");
  }
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO process_release_governance_reviews
    (id, tenant_id, blueprint_id, release_id, release_checksum, decision, evidence, decided_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, blueprintId, releaseId, release.checksum,
      body.decision, evidence, actorId).run();
  if (Number(result.meta.changes) !== 1) {
    throw new Error("This immutable release already has a governance decision");
  }
  return {
    releaseId, version: Number(release.version), releaseChecksum: String(release.checksum),
    decision: body.decision as "approved" | "rejected", evidence, decidedBy: actorId
  };
}

