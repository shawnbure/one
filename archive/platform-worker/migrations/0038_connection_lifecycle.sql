ALTER TABLE connections ADD COLUMN credential_expires_at TEXT;
ALTER TABLE connections ADD COLUMN rotation_owner TEXT;
ALTER TABLE connections ADD COLUMN last_rotated_at TEXT;
ALTER TABLE connections ADD COLUMN last_success_at TEXT;
ALTER TABLE connections ADD COLUMN health_message TEXT;
ALTER TABLE connections ADD COLUMN expiry_alerted_at TEXT;

UPDATE connections
SET health_message=CASE
      WHEN status='healthy' THEN 'Connection was healthy at the last recorded check; prior successful-use evidence was not backfilled.'
      WHEN status='attention' THEN 'Connection needs operator attention.'
      ELSE 'Connection is not configured.'
    END
WHERE health_message IS NULL;

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity)
SELECT 'notify-connection-expiry-' || id, id, 'connection.credential_expiring',
  'in_app', NULL, 1, 'warning'
FROM tenants;
