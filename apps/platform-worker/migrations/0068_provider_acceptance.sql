CREATE TABLE provider_acceptance_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  connection_id TEXT NOT NULL REFERENCES connections(id),
  provider TEXT NOT NULL CHECK (provider IN ('microsoft')),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  requested_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  started_by TEXT NOT NULL REFERENCES tenant_members(id),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX provider_acceptance_runs_tenant_latest
  ON provider_acceptance_runs(tenant_id, provider, completed_at DESC);
