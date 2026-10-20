import type { Env } from "./types";
import { emitNotification } from "./notifications";

export interface AccessEvidence {
  sessionId: string;
  issuedAt: string | null;
  expiresAt: string | null;
  identityType: "human" | "service";
}

export async function recordAccessSession(env: Env, request: Request, principal: {
  id: string; tenant_id: string; identity_type: "human" | "service";
}, evidence: AccessEvidence) {
  const now = new Date().toISOString();
  const clientLabel = describeClient(request.headers.get("user-agent"));
  const country = boundedCode(request.headers.get("cf-ipcountry"), 2);
  const colo = boundedCode(request.headers.get("cf-ray")?.split("-").at(-1) ?? null, 4);
  const sessionWrite = await env.DB.prepare(`INSERT INTO access_sessions
    (id, tenant_id, actor_id, identity_type, client_label, country_code, colo_code,
      issued_at, expires_at, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,
      request_count=access_sessions.request_count+1
    WHERE datetime(access_sessions.last_seen_at) <= datetime(excluded.last_seen_at, '-15 minutes')`)
    .bind(evidence.sessionId, principal.tenant_id, principal.id, evidence.identityType,
      clientLabel, country, colo, evidence.issuedAt, evidence.expiresAt, now, now).run();
  if (sessionWrite.meta.changes !== 1 || principal.identity_type !== "human") return;

  const emergency = await env.DB.prepare(`INSERT OR IGNORE INTO emergency_access_events
    (id, tenant_id, member_id, access_session_id)
    SELECT ?, tenant_id, member_id, ? FROM emergency_access_plans
    WHERE tenant_id=? AND member_id=? AND enabled=1`)
    .bind(`emergency-${evidence.sessionId}`, evidence.sessionId, principal.tenant_id, principal.id).run();
  if (emergency.meta.changes !== 1) return;
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, 'access.emergency_session_observed', 'access_session', ?, ?)`)
    .bind(crypto.randomUUID(), principal.tenant_id, principal.id, evidence.sessionId,
      JSON.stringify({ clientLabel, country, colo })).run();
  try {
    await emitNotification(env, principal.tenant_id, {
      eventType: "incident.critical",
      title: "Emergency administrator session observed",
      detail: `The designated emergency identity opened a new ${clientLabel} session. Review and classify this access.`,
      targetType: "emergency_access_event",
      targetId: `emergency-${evidence.sessionId}`
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "emergency_access_notification_failed", error: String(error) }));
  }
}

export async function getAccessOperations(env: Env, tenantId: string) {
  const [sessions, plan, events, eligible] = await Promise.all([
    env.DB.prepare(`SELECT s.id, s.actor_id, s.identity_type, s.client_label, s.country_code,
      s.colo_code, s.issued_at, s.expires_at, s.first_seen_at, s.last_seen_at, s.request_count,
      COALESCE(m.display_name, p.display_name, 'Unknown identity') actor_name,
      COALESCE(m.email, 'service:' || p.access_common_name) actor_email
      FROM access_sessions s
      LEFT JOIN tenant_members m ON m.id=s.actor_id AND m.tenant_id=s.tenant_id
      LEFT JOIN access_service_principals p ON p.id=s.actor_id AND p.tenant_id=s.tenant_id
      WHERE s.tenant_id=? ORDER BY s.last_seen_at DESC LIMIT 100`).bind(tenantId).all(),
    env.DB.prepare(`SELECT p.*, m.display_name member_name, m.email member_email
      FROM emergency_access_plans p JOIN tenant_members m
        ON m.id=p.member_id AND m.tenant_id=p.tenant_id
      WHERE p.tenant_id=?`).bind(tenantId).first(),
    env.DB.prepare(`SELECT e.*, m.display_name member_name, r.display_name reviewer_name,
      s.client_label, s.country_code, s.colo_code
      FROM emergency_access_events e
      JOIN tenant_members m ON m.id=e.member_id AND m.tenant_id=e.tenant_id
      JOIN access_sessions s ON s.id=e.access_session_id AND s.tenant_id=e.tenant_id
      LEFT JOIN tenant_members r ON r.id=e.reviewed_by AND r.tenant_id=e.tenant_id
      WHERE e.tenant_id=? ORDER BY e.observed_at DESC LIMIT 50`).bind(tenantId).all(),
    env.DB.prepare(`SELECT id, display_name, email FROM tenant_members
      WHERE tenant_id=? AND role='admin' AND status='active' ORDER BY display_name`)
      .bind(tenantId).all()
  ]);
  return { sessions: sessions.results, plan, events: events.results, eligibleAdmins: eligible.results };
}

export async function updateEmergencyAccessPlan(env: Env, tenantId: string, actorId: string, input: {
  memberId?: string; procedureSummary?: string; evidenceReference?: string;
  reviewDueAt?: string; enabled?: boolean; expectedRevision?: number;
}) {
  const memberId = input.memberId?.trim() ?? "";
  const procedure = input.procedureSummary?.trim() ?? "";
  const evidence = input.evidenceReference?.trim() ?? "";
  const reviewDue = new Date(input.reviewDueAt ?? "");
  if (memberId && memberId === actorId) {
    throw new Error("Emergency identity must be a separate active administrator membership");
  }
  if (!memberId || procedure.length < 20 || procedure.length > 1000 ||
      evidence.length < 5 || evidence.length > 300 ||
      Number.isNaN(reviewDue.valueOf()) || reviewDue <= new Date() ||
      reviewDue > new Date(Date.now() + 366 * 86_400_000)) {
    throw new Error("Select an administrator, provide a 20–1,000 character procedure, evidence reference, and review due within one year");
  }
  const member = await env.DB.prepare(`SELECT id FROM tenant_members
    WHERE id=? AND tenant_id=? AND role='admin' AND status='active'`)
    .bind(memberId, tenantId).first();
  if (!member) throw new Error("Emergency identity must be a separate active administrator membership");
  const existing = await env.DB.prepare("SELECT revision FROM emergency_access_plans WHERE tenant_id=?")
    .bind(tenantId).first<{ revision: number }>();
  if (existing && Number(input.expectedRevision) !== Number(existing.revision)) {
    throw new Error("Emergency access plan changed; reload before saving");
  }
  if (!existing && input.expectedRevision !== 0) throw new Error("Expected revision 0 for a new emergency access plan");
  const result = await env.DB.prepare(`INSERT INTO emergency_access_plans
    (tenant_id, member_id, procedure_summary, evidence_reference, review_due_at, enabled, revision, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET member_id=excluded.member_id,
      procedure_summary=excluded.procedure_summary, evidence_reference=excluded.evidence_reference,
      review_due_at=excluded.review_due_at, enabled=excluded.enabled,
      revision=emergency_access_plans.revision+1, updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP WHERE emergency_access_plans.revision=?`)
    .bind(tenantId, memberId, procedure, evidence, reviewDue.toISOString(),
      input.enabled === false ? 0 : 1, actorId, input.expectedRevision ?? 0).run();
  if (result.meta.changes !== 1) throw new Error("Emergency access plan changed; reload before saving");
  await audit(env, tenantId, actorId, "access.emergency_plan_updated", memberId, {
    enabled: input.enabled !== false, reviewDueAt: reviewDue.toISOString(), evidenceReference: evidence
  });
  return getAccessOperations(env, tenantId);
}

export async function reviewEmergencyAccessEvent(env: Env, tenantId: string, actorId: string,
  eventId: string, input: { classification?: string; note?: string; expectedRevision?: number }) {
  const classification = input.classification ?? "";
  const note = input.note?.trim() ?? "";
  if (!["drill", "incident", "false_positive"].includes(classification) ||
      note.length < 10 || note.length > 1000 || !Number.isInteger(input.expectedRevision)) {
    throw new Error("Classification, 10–1,000 character review note, and expected revision are required");
  }
  const result = await env.DB.prepare(`UPDATE emergency_access_events SET status='reviewed',
    classification=?, review_note=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP,
    revision=revision+1 WHERE id=? AND tenant_id=? AND status='open' AND revision=?`)
    .bind(classification, note, actorId, eventId, tenantId, input.expectedRevision).run();
  if (result.meta.changes !== 1) throw new Error("Emergency access event changed; reload before reviewing");
  await audit(env, tenantId, actorId, "access.emergency_session_reviewed", eventId, { classification });
  return getAccessOperations(env, tenantId);
}

export async function expireAccessSessions(env: Env, now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const result = await env.DB.prepare(`DELETE FROM access_sessions WHERE last_seen_at < ?
    AND id NOT IN (SELECT access_session_id FROM emergency_access_events)`).bind(cutoff).run();
  return { deleted: result.meta.changes };
}

export async function sessionEvidenceId(parts: Array<string | number | null | undefined>) {
  const bytes = new TextEncoder().encode(parts.map((part) => String(part ?? "")).join("|"));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function describeClient(userAgent: string | null) {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" :
    /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Unknown browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" :
      /Linux/.test(ua) ? "Linux" : "unknown device";
  return `${browser} on ${os}`;
}

function boundedCode(value: string | null, max: number) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]+$/.test(normalized) && normalized.length <= max ? normalized : null;
}

async function audit(env: Env, tenantId: string, actorId: string, eventType: string,
  targetId: string, detail: unknown) {
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'emergency_access', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, targetId, JSON.stringify(detail)).run();
}
