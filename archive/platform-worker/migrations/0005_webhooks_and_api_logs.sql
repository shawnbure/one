CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  secret_binding TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('active','disabled')),
  accepted_events_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_received_at TEXT
);

CREATE TABLE webhook_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
  idempotency_key TEXT NOT NULL,
  event_type TEXT,
  execution_id TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (endpoint_id, idempotency_key)
);

CREATE TABLE api_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  actor_id TEXT,
  trace_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX api_logs_tenant_created ON api_logs(tenant_id, created_at DESC);
CREATE INDEX webhook_receipts_endpoint_received ON webhook_receipts(endpoint_id, received_at DESC);

INSERT INTO webhook_endpoints (id, tenant_id, name, blueprint_id, secret_binding, status, accepted_events_json)
VALUES ('inbox-intake', 'demo', 'Inbox intake webhook', 'inbox-triage', 'WEBHOOK_INBOX_SECRET', 'disabled', '["request.created"]');
