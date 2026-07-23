import type { Env } from "./types";

export async function emitNotification(env: Env, tenantId: string, event: {
  eventType: string; title: string; detail: string; targetType?: string; targetId?: string;
}) {
  const policies = await env.DB.prepare(`SELECT * FROM notification_policies
    WHERE tenant_id = ? AND event_type = ? AND enabled = 1`).bind(tenantId, event.eventType).all<Record<string, string | number | null>>();
  if (!policies.results.length) return [];
  const ids: string[] = [];
  for (const policy of policies.results) {
    const id = crypto.randomUUID();
    ids.push(id);
    const channel = String(policy.channel);
    const status = channel === "in_app" ? "delivered" : "pending";
    await env.DB.prepare(`INSERT INTO notification_events
      (id, tenant_id, policy_id, event_type, severity, title, detail, target_type, target_id, delivery_status, delivered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, tenantId, policy.id, event.eventType, policy.severity, event.title, event.detail,
        event.targetType ?? null, event.targetId ?? null, status, status === "delivered" ? new Date().toISOString() : null).run();
  }
  return ids;
}
