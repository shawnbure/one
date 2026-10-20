CREATE TABLE governance_review_alert_receipts (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  review_key TEXT NOT NULL,
  due_at TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('due','overdue')),
  notification_event_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, review_key, due_at, stage)
);

CREATE INDEX idx_governance_review_alert_receipts_created
  ON governance_review_alert_receipts(created_at);

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity, owner_id,
   acknowledgement_required, escalation_minutes)
SELECT
  'notify-governance-review-' || substr(hex(randomblob(8)), 1, 16),
  t.id,
  'governance.review_due',
  'in_app',
  NULL,
  1,
  'warning',
  COALESCE(
    (SELECT support_owner_id FROM tenant_lifecycle_settings WHERE tenant_id=t.id),
    (SELECT id FROM tenant_members WHERE tenant_id=t.id AND status='active'
      AND role IN ('owner','admin','operator')
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1)
  ),
  1,
  1440
FROM tenants t;
