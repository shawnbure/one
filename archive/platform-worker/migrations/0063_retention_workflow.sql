ALTER TABLE retention_enforcement_runs RENAME TO retention_enforcement_runs_legacy;

CREATE TABLE retention_enforcement_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  workflow_id TEXT,
  cutoffs_json TEXT NOT NULL DEFAULT '{}',
  actor_cursor TEXT,
  processed_actors INTEGER NOT NULL DEFAULT 0,
  expired_turns INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

INSERT INTO retention_enforcement_runs
  (id, tenant_id, status, evidence_json, error, started_at, completed_at)
SELECT id, tenant_id, status, evidence_json, error, started_at, completed_at
FROM retention_enforcement_runs_legacy;

DROP TABLE retention_enforcement_runs_legacy;

CREATE INDEX idx_retention_runs_tenant_started
  ON retention_enforcement_runs(tenant_id, started_at DESC);

CREATE UNIQUE INDEX idx_retention_runs_active_tenant
  ON retention_enforcement_runs(tenant_id)
  WHERE status IN ('queued','running');
