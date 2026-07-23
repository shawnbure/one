import type { Env } from "./types";
import { emitNotification } from "./notifications";

interface OverdueApproval {
  id: string;
  tenant_id: string;
  execution_id: string;
  title: string | null;
  assigned_to: string | null;
  due_at: string;
}

export async function escalateOverdueApprovals(env: Env, now = new Date()) {
  const { results } = await env.DB.prepare(`SELECT id, tenant_id, execution_id, title, assigned_to, due_at
    FROM approvals
    WHERE status='pending' AND due_at IS NOT NULL AND datetime(due_at)<=datetime(?)
      AND sla_escalated_at IS NULL
    ORDER BY datetime(due_at), id LIMIT 100`).bind(now.toISOString()).all<OverdueApproval>();
  let escalated = 0;
  for (const approval of results) {
    const claimed = await env.DB.prepare(`UPDATE approvals
      SET sla_escalated_at=?, sla_escalation_count=sla_escalation_count+1,
        escalation_level=MAX(escalation_level, 1), last_activity_at=?
      WHERE id=? AND tenant_id=? AND status='pending' AND sla_escalated_at IS NULL`)
      .bind(now.toISOString(), now.toISOString(), approval.id, approval.tenant_id).run();
    if (claimed.meta.changes !== 1) continue;
    escalated += 1;
    await env.DB.prepare(`INSERT INTO audit_events
      (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json, created_at)
      VALUES (?, ?, 'system', 'approval.sla_escalated', 'approval', ?, ?, ?)`)
      .bind(crypto.randomUUID(), approval.tenant_id, approval.id, JSON.stringify({
        executionId: approval.execution_id, dueAt: approval.due_at,
        assigned: Boolean(approval.assigned_to), escalationCount: 1
      }), now.toISOString()).run();
    try {
      await emitNotification(env, approval.tenant_id, {
        eventType: "approval.pending", title: "Approval response SLA overdue",
        detail: approval.title ?? `Review ${approval.id}`,
        targetType: "approval", targetId: approval.id
      });
    } catch (error) {
      console.error(JSON.stringify({ event: "approval_sla_notification_failed",
        approvalId: approval.id, error: String(error) }));
    }
  }
  return { inspected: results.length, escalated };
}
