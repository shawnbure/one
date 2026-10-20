import type { Role } from "./auth";
import { emitNotification } from "./notifications";
import type { Env } from "./types";
import { resolveRequestedApprovalAssignee } from "./approval-delegations";
import { applyDlp, DlpBlockedError } from "./dlp";

export type ApprovalMessageKind = "comment" | "information_request" | "information_response" | "escalation";

export async function assignApproval(env: Env, tenantId: string, actorId: string, approvalId: string,
  assignedTo: string) {
  const member = await resolveRequestedApprovalAssignee(env, tenantId, assignedTo);
  if (!member) throw new Error("Assignee must be an active administrator, owner, operator, or reviewer in this organization");
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE approvals SET assigned_to=?, assigned_via_delegation_from=?,
    last_activity_at=?
    WHERE id=? AND tenant_id=? AND status='pending'`)
    .bind(member.email, member.delegated ? member.original_member_id : null, now, approvalId, tenantId).run();
  if (result.meta.changes !== 1) throw new Error("Review item is not pending or was not found");
  await audit(env, tenantId, actorId, "approval.assigned", approvalId, {
    requestedMemberId: member.original_member_id, assignedMemberId: member.id,
    assignedRole: member.role, delegated: Boolean(member.delegated)
  }).run();
  return { updated: true, assignedTo: member.email, displayName: member.display_name,
    delegated: Boolean(member.delegated), requestedMemberId: member.original_member_id };
}

export async function bulkAssignApprovals(env: Env, tenantId: string, actorId: string, raw: {
  assignedTo?: unknown;
  reason?: unknown;
  items?: unknown;
}) {
  const input = validateBulkAssignment(raw);
  const member = await resolveRequestedApprovalAssignee(env, tenantId, input.assignedTo);
  if (!member) throw new Error("Assignee must be an active administrator, owner, operator, or reviewer in this organization");
  const protectedReason = await applyDlp(env, tenantId, input.reason, {
    direction: "input", stage: "approval_bulk_assignment",
  });
  if (protectedReason.blocked) throw new DlpBlockedError(protectedReason.blockedDetectors);
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const statements = input.items.flatMap((item) => [
    env.DB.prepare(`UPDATE approvals SET assigned_to=?, assigned_via_delegation_from=?, last_activity_at=?,
      revision=revision+1
      WHERE id=? AND tenant_id=? AND status='pending' AND revision=?`)
      .bind(member.email, member.delegated ? member.original_member_id : null, now,
        item.id, tenantId, item.expectedRevision),
    env.DB.prepare(`INSERT INTO audit_events
      (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json, created_at)
      SELECT ?, ?, ?, 'approval.bulk_assigned', 'approval', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM approvals WHERE id=? AND tenant_id=? AND status='pending'
        AND revision=? AND assigned_to=? AND last_activity_at=?)`)
      .bind(crypto.randomUUID(), tenantId, actorId, item.id, JSON.stringify({
        batchId, requestedMemberId: member.original_member_id, assignedMemberId: member.id,
        assignedRole: member.role, delegated: Boolean(member.delegated), reason: protectedReason.safeText,
      }), now, item.id, tenantId, item.expectedRevision + 1, member.email, now),
  ]);
  const results = await env.DB.batch(statements);
  const updatedIds = input.items.filter((_, index) => results[index * 2]?.meta.changes === 1)
    .map((item) => item.id);
  const updated = new Set(updatedIds);
  return {
    batchId,
    requested: input.items.length,
    updated: updatedIds.length,
    conflicts: input.items.length - updatedIds.length,
    updatedIds,
    conflictIds: input.items.filter((item) => !updated.has(item.id)).map((item) => item.id),
    assignedTo: member.email,
    displayName: member.display_name,
    delegated: Boolean(member.delegated),
  };
}

export function validateBulkAssignment(raw: { assignedTo?: unknown; reason?: unknown; items?: unknown }) {
  const assignedTo = typeof raw.assignedTo === "string" ? raw.assignedTo.trim() : "";
  if (!assignedTo || assignedTo.length > 320) throw new Error("A valid assignee is required");
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (reason.length < 10 || reason.length > 500) {
    throw new Error("Bulk assignment reason must be 10 to 500 characters");
  }
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 25) {
    throw new Error("Select between 1 and 25 review items");
  }
  const seen = new Set<string>();
  const items = raw.items.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Each review item must include an ID and revision");
    const item = value as { id?: unknown; expectedRevision?: unknown };
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const expectedRevision = Number(item.expectedRevision);
    if (!id || id.length > 100 || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error("Each review item must include a valid ID and revision");
    }
    if (seen.has(id)) throw new Error("Duplicate review items are not allowed");
    seen.add(id);
    return { id, expectedRevision };
  });
  return { assignedTo, reason, items };
}

export async function addApprovalMessage(env: Env, tenantId: string, actorId: string, actorEmail: string,
  actorRole: Role, approvalId: string, kind: ApprovalMessageKind, body: string) {
  const text = body.trim();
  if (!text || text.length > 4000) throw new Error("Collaboration message must be 1–4,000 characters");
  assertAllowed(kind, actorRole);
  const approval = await env.DB.prepare(`SELECT id, execution_id, title, status, review_state, escalation_level
    FROM approvals WHERE id=? AND tenant_id=?`).bind(approvalId, tenantId).first<{
      id: string; execution_id: string; title: string | null; status: string;
      review_state: string; escalation_level: number;
    }>();
  if (!approval) throw new Error("Review item was not found");
  if (approval.status !== "pending") throw new Error("Resolved review items cannot receive new collaboration messages");
  if (kind === "information_response" && approval.review_state !== "information_requested") {
    throw new Error("There is no outstanding information request");
  }
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const nextState = kind === "information_request" ? "information_requested"
    : kind === "information_response" ? "decision_pending"
      : kind === "escalation" ? "escalated" : approval.review_state;
  const nextEscalation = kind === "escalation" ? Math.min(3, Number(approval.escalation_level) + 1)
    : Number(approval.escalation_level);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO approval_messages
      (id, tenant_id, approval_id, author_id, author_email, kind, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(messageId, tenantId, approvalId, actorId, actorEmail, kind, text, now),
    env.DB.prepare(`UPDATE approvals SET review_state=?, escalation_level=?, last_activity_at=?
      WHERE id=? AND tenant_id=? AND status='pending'`)
      .bind(nextState, nextEscalation, now, approvalId, tenantId),
    audit(env, tenantId, actorId, `approval.${kind}`, approvalId, {
      messageId, reviewState: nextState, escalationLevel: nextEscalation
    })
  ]);
  if (kind !== "comment") {
    await emitNotification(env, tenantId, {
      eventType: "approval.pending",
      title: kind === "escalation" ? "Approval escalated"
        : kind === "information_request" ? "Approval needs more information" : "Approval information received",
      detail: approval.title ?? `Review ${approvalId}`,
      targetType: "approval",
      targetId: approvalId
    });
  }
  return {
    message: { id: messageId, author_id: actorId, author_email: actorEmail, kind, body: text, created_at: now },
    reviewState: nextState,
    escalationLevel: nextEscalation
  };
}

function assertAllowed(kind: ApprovalMessageKind, role: Role) {
  const allowed: Record<ApprovalMessageKind, Role[]> = {
    comment: ["admin", "builder", "owner", "operator", "reviewer"],
    information_request: ["admin", "owner", "reviewer"],
    information_response: ["admin", "builder", "owner", "operator"],
    escalation: ["admin", "owner", "operator", "reviewer"]
  };
  if (!allowed[kind].includes(role)) throw new Error(`Role ${role} cannot submit an approval ${kind.replaceAll("_", " ")}`);
}

function audit(env: Env, tenantId: string, actorId: string, eventType: string, approvalId: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'approval', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, approvalId, JSON.stringify(detail));
}
