import type { Role } from "./auth";
import { emitNotification } from "./notifications";
import type { Env } from "./types";
import { resolveRequestedApprovalAssignee } from "./approval-delegations";

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
