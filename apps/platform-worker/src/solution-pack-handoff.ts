import type { Env } from "./types";

export class SolutionPackHandoffConflict extends Error {}

export async function listSolutionPackHandoffChecks(env: Env, tenantId: string, blueprintId: string) {
  const { results } = await env.DB.prepare(`SELECT h.id, h.check_order, h.description, h.status, h.evidence,
    h.revision, h.completed_by, h.completed_at, h.created_at, h.updated_at, m.display_name completed_by_name
    FROM process_solution_pack_handoff_checks h
    LEFT JOIN tenant_members m ON m.id=h.completed_by AND m.tenant_id=h.tenant_id
    WHERE h.tenant_id=? AND h.blueprint_id=? ORDER BY h.check_order`)
    .bind(tenantId, blueprintId).all();
  return results;
}

export async function updateSolutionPackHandoffCheck(env: Env, tenantId: string, blueprintId: string,
  checkId: string, actorId: string, input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Handoff decision is required");
  const body = input as { status?: string; evidence?: string; expectedRevision?: number };
  if (!["complete", "not_applicable", "open"].includes(body.status ?? "")) {
    throw new Error("Select a valid handoff status");
  }
  const evidence = String(body.evidence ?? "").trim();
  if (body.status !== "open" && (evidence.length < 10 || evidence.length > 1000)) {
    throw new Error("Completion or not-applicable evidence must be 10 to 1,000 characters");
  }
  if (body.status === "open" && evidence.length > 1000) throw new Error("Handoff evidence exceeds 1,000 characters");
  const revision = Number(body.expectedRevision);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("Current handoff revision is required");
  const result = await env.DB.prepare(`UPDATE process_solution_pack_handoff_checks
    SET status=?, evidence=?, completed_by=?, completed_at=?,
      revision=revision+1, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND blueprint_id=? AND revision=?`)
    .bind(body.status, evidence || null, body.status === "open" ? null : actorId,
      body.status === "open" ? null : new Date().toISOString(), checkId, tenantId, blueprintId, revision).run();
  if (Number(result.meta.changes) !== 1) {
    const exists = await env.DB.prepare(`SELECT revision FROM process_solution_pack_handoff_checks
      WHERE id=? AND tenant_id=? AND blueprint_id=?`).bind(checkId, tenantId, blueprintId).first();
    if (!exists) throw new Error("Solution pack handoff check was not found");
    throw new SolutionPackHandoffConflict("Handoff evidence changed; reload before deciding");
  }
  return { id: checkId, status: body.status, revision: revision + 1 };
}
