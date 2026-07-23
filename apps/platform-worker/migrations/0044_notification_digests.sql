ALTER TABLE notification_policies ADD COLUMN digest_mode TEXT NOT NULL DEFAULT 'immediate'
  CHECK (digest_mode IN ('immediate','hourly','daily'));
ALTER TABLE notification_policies ADD COLUMN digest_hour_utc INTEGER NOT NULL DEFAULT 8
  CHECK (digest_hour_utc BETWEEN 0 AND 23);

ALTER TABLE notification_events ADD COLUMN digest_batch_id TEXT;
ALTER TABLE notification_events ADD COLUMN digest_item_count INTEGER;

CREATE INDEX idx_notification_events_digest
  ON notification_events(tenant_id, policy_id, digest_batch_id, delivery_status);
