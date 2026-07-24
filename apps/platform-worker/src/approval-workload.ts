import type { Env } from "./types";

export interface ApprovalWorkloadMember {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "owner" | "operator" | "reviewer";
  effective_id: string;
  effective_email: string;
  effective_display_name: string;
  effective_role: "admin" | "owner" | "operator" | "reviewer";
  delegated: number;
  pending_count: number;
  overdue_count: number;
  due_soon_count: number;
  oldest_minutes: number;
}

export async function listApprovalWorkload(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare(`WITH eligible AS (
      SELECT m.id, m.email, m.display_name, m.role,
        COALESCE(x.id,m.id) effective_id, COALESCE(x.email,m.email) effective_email,
        COALESCE(x.display_name,m.display_name) effective_display_name,
        COALESCE(x.role,m.role) effective_role,
        CASE WHEN x.id IS NULL THEN 0 ELSE 1 END delegated
      FROM tenant_members m
      LEFT JOIN approval_delegations d ON d.tenant_id=m.tenant_id AND d.member_id=m.id AND d.enabled=1
        AND datetime(d.starts_at)<=datetime('now') AND datetime(d.ends_at)>datetime('now')
      LEFT JOIN tenant_members x ON x.id=d.delegate_id AND x.tenant_id=m.tenant_id
        AND x.status='active' AND x.role IN ('admin','owner','operator','reviewer')
      WHERE m.tenant_id=? AND m.status='active'
        AND m.role IN ('admin','owner','operator','reviewer')
    )
    SELECT e.*,
      COUNT(a.id) pending_count,
      COALESCE(SUM(CASE WHEN a.due_at IS NOT NULL AND datetime(a.due_at)<datetime('now')
        THEN 1 ELSE 0 END),0) overdue_count,
      COALESCE(SUM(CASE WHEN a.due_at IS NOT NULL AND datetime(a.due_at)>=datetime('now')
        AND datetime(a.due_at)<=datetime('now','+4 hours') THEN 1 ELSE 0 END),0) due_soon_count,
      COALESCE(MAX(CAST((julianday('now')-julianday(a.requested_at))*1440 AS INTEGER)),0) oldest_minutes
    FROM eligible e
    LEFT JOIN approvals a ON a.tenant_id=? AND a.status='pending'
      AND lower(a.assigned_to)=lower(e.effective_email)
    GROUP BY e.id, e.email, e.display_name, e.role, e.effective_id, e.effective_email,
      e.effective_display_name, e.effective_role, e.delegated
    ORDER BY overdue_count, pending_count, due_soon_count, e.effective_display_name, e.display_name
    LIMIT 50`).bind(tenantId, tenantId).all<ApprovalWorkloadMember>();
  return results;
}

