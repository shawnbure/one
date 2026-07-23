ALTER TABLE mcp_connectors ADD COLUMN last_checked_at TEXT;
ALTER TABLE mcp_connectors ADD COLUMN last_success_at TEXT;
ALTER TABLE mcp_connectors ADD COLUMN health_alerted_at TEXT;

CREATE INDEX idx_mcp_connectors_health_scan
  ON mcp_connectors(status, last_checked_at);

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity,
   owner_id, acknowledgement_required, escalation_minutes)
SELECT 'notify-mcp-health-' || t.id, t.id, 'connection.mcp_attention',
  'in_app', NULL, 1, 'critical',
  COALESCE(
    (SELECT recovery_owner_id FROM tenant_lifecycle_settings WHERE tenant_id=t.id),
    (SELECT support_owner_id FROM tenant_lifecycle_settings WHERE tenant_id=t.id),
    (SELECT id FROM tenant_members WHERE tenant_id=t.id AND status='active'
      AND role IN ('owner','admin','operator')
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1)
  ),
  1, 240
FROM tenants t;
