import type { Role } from "./auth";
import type { Env } from "./types";

const eligibleRoles = ["admin", "owner", "operator", "reviewer"];

export class DelegationConflict extends Error {}

export async function listApprovalDelegations(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare(`SELECT d.*, m.display_name member_name, m.email member_email,
    x.display_name delegate_name, x.email delegate_email,
    CASE WHEN d.enabled=1 AND datetime(d.starts_at)<=datetime('now')
      AND datetime(d.ends_at)>datetime('now') THEN 1 ELSE 0 END active_now
    FROM approval_delegations d
    JOIN tenant_members m ON m.id=d.member_id AND m.tenant_id=d.tenant_id
    JOIN tenant_members x ON x.id=d.delegate_id AND x.tenant_id=d.tenant_id
    WHERE d.tenant_id=? ORDER BY d.enabled DESC, datetime(d.starts_at), m.display_name`)
    .bind(tenantId).all();
  return results;
}

export async function setApprovalDelegation(env: Env, tenantId: string, actorId: string, actorRole: Role,
  memberId: string, input: {
    delegateId?: string; startsAt?: string; endsAt?: string; reason?: string;
    enabled?: boolean; expectedRevision?: number;
  }) {
  if (!["admin", "owner"].includes(actorRole) && actorId !== memberId) {
    throw new Error("Only an owner, administrator, or the member can change this delegation");
  }
  const delegateId = input.delegateId ?? "";
  if (!delegateId || delegateId === memberId) throw new Error("Choose a different eligible delegate");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5 || reason.length > 500) throw new Error("Delegation reason must be 5–500 characters");
  const startsAt = parseTime(input.startsAt, "Start");
  const endsAt = parseTime(input.endsAt, "End");
  const now = Date.now();
  if (startsAt.getTime() < now - 24 * 60 * 60_000) throw new Error("Delegation start cannot be more than one day in the past");
  if (endsAt <= startsAt || endsAt.getTime() <= now) throw new Error("Delegation end must be after its start and in the future");
  if (endsAt.getTime() > now + 90 * 24 * 60 * 60_000) throw new Error("Delegation cannot extend beyond 90 days");
  const { results: members } = await env.DB.prepare(`SELECT id, role, status FROM tenant_members
    WHERE tenant_id=? AND id IN (?, ?)`).bind(tenantId, memberId, delegateId)
    .all<{ id: string; role: string; status: string }>();
  if (members.length !== 2 || members.some((member) =>
    member.status !== "active" || !eligibleRoles.includes(member.role))) {
    throw new Error("Both people must be active approval-eligible members of this organization");
  }
  const cycle = await env.DB.prepare(`SELECT 1 cycle FROM approval_delegations
    WHERE tenant_id=? AND member_id=? AND delegate_id=? AND enabled=1
      AND datetime(starts_at)<datetime(?) AND datetime(ends_at)>datetime(?) LIMIT 1`)
    .bind(tenantId, delegateId, memberId, endsAt.toISOString(), startsAt.toISOString()).first();
  if (cycle) throw new Error("Delegation would create a two-person routing cycle");
  const current = await env.DB.prepare(`SELECT revision FROM approval_delegations
    WHERE tenant_id=? AND member_id=?`).bind(tenantId, memberId).first<{ revision: number }>();
  if (current && current.revision !== input.expectedRevision) {
    throw new DelegationConflict("Delegation changed; reload before saving");
  }
  const nextRevision = (current?.revision ?? 0) + 1;
  const result = await env.DB.prepare(`INSERT INTO approval_delegations
    (tenant_id, member_id, delegate_id, starts_at, ends_at, reason, enabled, revision,
      created_by, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_id, member_id) DO UPDATE SET delegate_id=excluded.delegate_id,
      starts_at=excluded.starts_at, ends_at=excluded.ends_at, reason=excluded.reason,
      enabled=excluded.enabled, revision=excluded.revision, updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP
    WHERE approval_delegations.revision=?`)
    .bind(tenantId, memberId, delegateId, startsAt.toISOString(), endsAt.toISOString(), reason,
      Number(input.enabled !== false), nextRevision, actorId, actorId, current?.revision ?? 0).run();
  if (result.meta.changes !== 1) throw new DelegationConflict("Delegation changed; reload before saving");
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, 'approval.delegation_updated', 'member', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, memberId, JSON.stringify({
      delegateId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
      enabled: input.enabled !== false, revision: nextRevision
    })).run();
  return { memberId, delegateId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    enabled: input.enabled !== false, revision: nextRevision };
}

export async function resolveDefaultApprovalAssignee(env: Env, tenantId: string) {
  return env.DB.prepare(`WITH preferred AS (
      SELECT m.id, m.email, m.display_name FROM tenant_members m
      LEFT JOIN tenant_lifecycle_settings l ON l.tenant_id=m.tenant_id
      WHERE m.tenant_id=? AND m.status='active'
        AND m.role IN ('admin','owner','operator','reviewer')
      ORDER BY CASE WHEN m.id=l.support_owner_id THEN 0 WHEN m.role='owner' THEN 1
        WHEN m.role='admin' THEN 2 WHEN m.role='operator' THEN 3 ELSE 4 END, m.id LIMIT 1
    )
    SELECT COALESCE(x.email,p.email) email, COALESCE(x.display_name,p.display_name) display_name,
      p.id original_member_id, CASE WHEN x.id IS NULL THEN 0 ELSE 1 END delegated,
      x.id delegate_member_id
    FROM preferred p
    LEFT JOIN approval_delegations d ON d.tenant_id=? AND d.member_id=p.id AND d.enabled=1
      AND datetime(d.starts_at)<=datetime('now') AND datetime(d.ends_at)>datetime('now')
    LEFT JOIN tenant_members x ON x.id=d.delegate_id AND x.tenant_id=d.tenant_id
      AND x.status='active' AND x.role IN ('admin','owner','operator','reviewer')`)
    .bind(tenantId, tenantId).first<{ email: string; display_name: string; original_member_id: string;
      delegated: number; delegate_member_id: string | null }>();
}

export async function resolveRequestedApprovalAssignee(env: Env, tenantId: string, assignedTo: string) {
  return env.DB.prepare(`SELECT COALESCE(x.id,m.id) id, COALESCE(x.email,m.email) email,
    COALESCE(x.display_name,m.display_name) display_name, COALESCE(x.role,m.role) role,
    m.id original_member_id, CASE WHEN x.id IS NULL THEN 0 ELSE 1 END delegated
    FROM tenant_members m
    LEFT JOIN approval_delegations d ON d.tenant_id=m.tenant_id AND d.member_id=m.id AND d.enabled=1
      AND datetime(d.starts_at)<=datetime('now') AND datetime(d.ends_at)>datetime('now')
    LEFT JOIN tenant_members x ON x.id=d.delegate_id AND x.tenant_id=m.tenant_id
      AND x.status='active' AND x.role IN ('admin','owner','operator','reviewer')
    WHERE m.tenant_id=? AND m.status='active' AND (m.id=? OR lower(m.email)=lower(?))
      AND m.role IN ('admin','owner','operator','reviewer') LIMIT 1`)
    .bind(tenantId, assignedTo, assignedTo).first<{
      id: string; email: string; display_name: string; role: string; original_member_id: string; delegated: number;
    }>();
}

function parseTime(value: string | undefined, label: string) {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} date is required`);
  return date;
}
