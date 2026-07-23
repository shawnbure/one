CREATE TABLE notification_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app','email','webhook')),
  destination TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  severity TEXT NOT NULL DEFAULT 'warning',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, event_type, channel)
);

CREATE TABLE notification_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  policy_id TEXT REFERENCES notification_policies(id),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('recorded','pending','delivered','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT
);

CREATE INDEX idx_notification_events_tenant_created ON notification_events(tenant_id, created_at DESC);

INSERT INTO notification_policies (id, tenant_id, event_type, channel, destination, enabled, severity) VALUES
 ('notify-approval', 'demo', 'approval.pending', 'in_app', NULL, 1, 'warning'),
 ('notify-execution', 'demo', 'execution.failed', 'in_app', NULL, 1, 'critical'),
 ('notify-queue', 'demo', 'queue.retry_exhausted', 'in_app', NULL, 1, 'critical');
