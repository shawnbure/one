CREATE TABLE evaluation_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  scenario_id TEXT NOT NULL REFERENCES evaluation_scenarios(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  release_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('passing','failing')),
  passed_assertions INTEGER NOT NULL,
  assertion_count INTEGER NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  triggered_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_evaluation_runs_tenant_created
  ON evaluation_runs(tenant_id, created_at DESC);

CREATE INDEX idx_evaluation_runs_scenario_created
  ON evaluation_runs(scenario_id, created_at DESC);
