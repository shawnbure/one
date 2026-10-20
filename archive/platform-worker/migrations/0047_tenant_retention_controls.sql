CREATE TABLE tenant_retention_controls (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  conversation_days INTEGER NOT NULL DEFAULT 90 CHECK (conversation_days BETWEEN 1 AND 2555),
  execution_days INTEGER NOT NULL DEFAULT 365 CHECK (execution_days BETWEEN 1 AND 2555),
  approval_days INTEGER NOT NULL DEFAULT 365 CHECK (approval_days BETWEEN 1 AND 2555),
  notification_days INTEGER NOT NULL DEFAULT 180 CHECK (notification_days BETWEEN 1 AND 2555),
  api_log_days INTEGER NOT NULL DEFAULT 90 CHECK (api_log_days BETWEEN 1 AND 2555),
  legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0,1)),
  legal_hold_reason TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_enforced_at TEXT
);

CREATE TABLE retention_enforcement_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX idx_retention_runs_tenant_started
  ON retention_enforcement_runs(tenant_id, started_at DESC);

INSERT INTO tenant_retention_controls (tenant_id, updated_by)
SELECT id, 'system' FROM tenants;
