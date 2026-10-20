ALTER TABLE access_service_principals ADD COLUMN credential_expires_at TEXT;
ALTER TABLE access_service_principals ADD COLUMN rotation_owner TEXT;
ALTER TABLE access_service_principals ADD COLUMN last_rotated_at TEXT;
ALTER TABLE access_service_principals ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE access_service_principals ADD COLUMN updated_at TEXT;

UPDATE access_service_principals
SET credential_expires_at = datetime(created_at, '+90 days'),
    last_rotated_at = created_at,
    updated_at = CURRENT_TIMESTAMP
WHERE credential_expires_at IS NULL;

CREATE INDEX idx_service_principal_expiry
  ON access_service_principals(status, credential_expires_at);

CREATE TABLE service_principal_expiry_alerts (
  principal_id TEXT NOT NULL REFERENCES access_service_principals(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  expires_at TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('warning','expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (principal_id, expires_at, stage)
);

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, enabled, severity, acknowledgement_required, escalation_minutes)
SELECT 'notify-service-principal-expiry-' || id, id, 'access.service_principal_expiring',
  'in_app', 1, 'critical', 1, 1440
FROM tenants;
