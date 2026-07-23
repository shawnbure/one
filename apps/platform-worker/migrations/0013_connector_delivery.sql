CREATE TABLE integration_credential_refs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  connection_id TEXT REFERENCES connections(id),
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  secret_binding TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'required' CHECK (status IN ('required','configured','invalid')),
  last_validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, secret_binding)
);

ALTER TABLE notification_policies ADD COLUMN credential_ref_id TEXT REFERENCES integration_credential_refs(id);
ALTER TABLE notification_events ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_events ADD COLUMN last_attempt_at TEXT;
ALTER TABLE notification_events ADD COLUMN last_error TEXT;
ALTER TABLE notification_events ADD COLUMN response_status INTEGER;

CREATE INDEX idx_notification_events_pending ON notification_events(delivery_status, created_at);

INSERT INTO integration_credential_refs
  (id, tenant_id, name, provider, secret_binding, purpose)
VALUES
  ('credential-notification-webhook', 'demo', 'Outbound webhook signing key', 'generic_webhook',
   'NOTIFICATION_WEBHOOK_SECRET', 'Signs Workrr notification deliveries with HMAC-SHA256');

INSERT INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity, credential_ref_id)
VALUES
  ('notify-execution-webhook', 'demo', 'execution.failed', 'webhook', NULL, 0, 'critical',
   'credential-notification-webhook');
