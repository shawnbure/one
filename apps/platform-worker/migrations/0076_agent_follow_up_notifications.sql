INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity, owner_id,
   acknowledgement_required, escalation_minutes)
SELECT 'notify-agent-follow-up-' || t.id, t.id, 'agent.follow_up_due',
  'in_app', NULL, 1, 'warning',
  COALESCE(l.support_owner_id, l.recovery_owner_id, (
    SELECT m.id FROM tenant_members m
    WHERE m.tenant_id=t.id AND m.status='active' AND m.role IN ('owner','admin','operator')
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at
    LIMIT 1
  )),
  1, 1440
FROM tenants t
LEFT JOIN tenant_lifecycle_settings l ON l.tenant_id=t.id;
