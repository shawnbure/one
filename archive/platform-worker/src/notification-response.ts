import type { Env } from "./types";

export async function acknowledgeNotification(env: Env, tenantId: string, actorId: string, eventId: string, note?: string) {
  const event = await env.DB.prepare(`SELECT e.id, e.acknowledged_at, p.channel, p.acknowledgement_required
    FROM notification_events e JOIN notification_policies p
      ON p.id=e.policy_id AND p.tenant_id=e.tenant_id
    WHERE e.id=? AND e.tenant_id=?`).bind(eventId, tenantId)
    .first<{ id: string; acknowledged_at: string | null; channel: string; acknowledgement_required: number }>();
  if (!event) throw new Error("Notification event was not found");
  if (event.channel !== "in_app") throw new Error("External delivery evidence is not an acknowledgement task");
  if (!Number(event.acknowledgement_required)) throw new Error("This notification does not require acknowledgement");
  if (event.acknowledged_at) return { id: eventId, acknowledged: true, duplicate: true };
  const cleanNote = String(note ?? "").trim();
  if (cleanNote.length > 1000) throw new Error("Acknowledgement note must be 1,000 characters or fewer");
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE notification_events SET acknowledged_at=?, acknowledged_by=?,
      acknowledgement_note=? WHERE id=? AND tenant_id=? AND acknowledged_at IS NULL`)
      .bind(now, actorId, cleanNote || null, eventId, tenantId),
    audit(env, tenantId, actorId, "notification.acknowledged", eventId, { note: cleanNote || null })
  ]);
  return { id: eventId, acknowledged: true,
    duplicate: Number((results[0] as { meta?: { changes?: number } }).meta?.changes) !== 1 };
}

export async function escalateUnacknowledgedNotifications(env: Env, now = new Date()) {
  const { results } = await env.DB.prepare(`SELECT e.id, e.tenant_id, e.event_type, e.title, e.detail,
    e.target_type, e.target_id, p.owner_id, p.escalation_minutes
    FROM notification_events e JOIN notification_policies p
      ON p.id=e.policy_id AND p.tenant_id=e.tenant_id
    WHERE p.channel='in_app' AND p.enabled=1 AND p.acknowledgement_required=1
      AND p.escalation_minutes>0 AND e.acknowledged_at IS NULL AND e.escalated_at IS NULL
      AND datetime(e.created_at, '+' || p.escalation_minutes || ' minutes') <= datetime(?)
    ORDER BY e.created_at LIMIT 100`).bind(now.toISOString()).all<{
      id: string; tenant_id: string; event_type: string; title: string; detail: string;
      target_type: string | null; target_id: string | null; owner_id: string | null; escalation_minutes: number;
    }>();
  let escalated = 0;
  for (const event of results) {
    const escalationId = crypto.randomUUID();
    const detail = `${event.title} remained unacknowledged for ${event.escalation_minutes} minutes. ` +
      `Assigned owner: ${event.owner_id ?? "unassigned"}.`;
    const claimed = await env.DB.prepare(`UPDATE notification_events SET escalated_at=?, escalation_event_id=?
      WHERE id=? AND tenant_id=? AND acknowledged_at IS NULL AND escalated_at IS NULL`)
      .bind(now.toISOString(), escalationId, event.id, event.tenant_id).run();
    if (claimed.meta.changes !== 1) continue;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO notification_events
        (id, tenant_id, policy_id, event_type, severity, title, detail, target_type, target_id,
         delivery_status, delivered_at, acknowledged_at, acknowledged_by, acknowledgement_note)
        SELECT ?, tenant_id, policy_id, ?, 'critical', ?, ?, target_type, target_id,
          'delivered', ?, ?, 'system', ?
        FROM notification_events WHERE id=? AND tenant_id=?`)
        .bind(escalationId, `${event.event_type}.escalated`, `Escalated: ${event.title}`.slice(0, 240),
          detail.slice(0, 1000), now.toISOString(), now.toISOString(),
          "System-generated escalation evidence; acknowledge the original alert.", event.id, event.tenant_id),
      audit(env, event.tenant_id, "system", "notification.escalated", event.id,
        { escalationEventId: escalationId, ownerId: event.owner_id, escalationMinutes: event.escalation_minutes })
    ]);
    escalated += 1;
  }
  return { escalated };
}

function audit(env: Env, tenantId: string, actorId: string, eventType: string, eventId: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'notification_event', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, eventId, JSON.stringify(detail));
}
