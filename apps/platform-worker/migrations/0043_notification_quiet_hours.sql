ALTER TABLE notification_policies ADD COLUMN quiet_hours_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (quiet_hours_enabled IN (0,1));
ALTER TABLE notification_policies ADD COLUMN quiet_start_hour_utc INTEGER NOT NULL DEFAULT 22
  CHECK (quiet_start_hour_utc BETWEEN 0 AND 23);
ALTER TABLE notification_policies ADD COLUMN quiet_end_hour_utc INTEGER NOT NULL DEFAULT 7
  CHECK (quiet_end_hour_utc BETWEEN 0 AND 23);
ALTER TABLE notification_policies ADD COLUMN critical_bypass INTEGER NOT NULL DEFAULT 1
  CHECK (critical_bypass IN (0,1));

ALTER TABLE notification_events ADD COLUMN delivery_scheduled_for TEXT;
ALTER TABLE notification_events ADD COLUMN delivery_queued_at TEXT;

UPDATE notification_events
SET delivery_scheduled_for=COALESCE(delivery_scheduled_for, created_at),
    delivery_queued_at=CASE
      WHEN delivery_status='pending' AND attempt_count > 0 THEN COALESCE(last_attempt_at, created_at)
      ELSE delivery_queued_at END
WHERE delivery_status='pending';

CREATE INDEX idx_notification_events_due_delivery
  ON notification_events(delivery_status, delivery_queued_at, delivery_scheduled_for);
