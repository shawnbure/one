CREATE TABLE tenant_bootstrap_runs (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  manifest_checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
  member_id TEXT REFERENCES tenant_members(id),
  process_id TEXT REFERENCES agent_blueprints(id),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT
);

INSERT INTO tenant_bootstrap_runs
  (tenant_id, idempotency_key, manifest_checksum, status, member_id, process_id, completed_at)
VALUES
  ('demo', 'seeded-demo-environment', 'seeded-demo-environment', 'completed',
   'member-demo-admin', 'customer-ops', CURRENT_TIMESTAMP);
