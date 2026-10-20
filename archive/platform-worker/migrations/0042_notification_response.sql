ALTER TABLE notification_policies ADD COLUMN owner_id TEXT;
ALTER TABLE notification_policies ADD COLUMN acknowledgement_required INTEGER NOT NULL DEFAULT 1
  CHECK (acknowledgement_required IN (0,1));
ALTER TABLE notification_policies ADD COLUMN escalation_minutes INTEGER NOT NULL DEFAULT 240
  CHECK (escalation_minutes >= 0 AND escalation_minutes <= 10080);

ALTER TABLE notification_events ADD COLUMN acknowledged_at TEXT;
ALTER TABLE notification_events ADD COLUMN acknowledged_by TEXT;
ALTER TABLE notification_events ADD COLUMN acknowledgement_note TEXT;
ALTER TABLE notification_events ADD COLUMN escalated_at TEXT;
ALTER TABLE notification_events ADD COLUMN escalation_event_id TEXT;

UPDATE notification_policies
SET owner_id = (
  SELECT m.id FROM tenant_members m
  WHERE m.tenant_id=notification_policies.tenant_id AND m.status='active'
    AND m.role IN ('admin','owner','operator')
  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at
  LIMIT 1
)
WHERE channel='in_app' AND owner_id IS NULL;

UPDATE notification_policies SET escalation_minutes=60
WHERE channel='in_app' AND severity='critical';

UPDATE notification_policies
SET acknowledgement_required=0, escalation_minutes=0
WHERE channel!='in_app';

CREATE INDEX idx_notification_events_response
  ON notification_events(tenant_id, acknowledged_at, escalated_at, created_at);

