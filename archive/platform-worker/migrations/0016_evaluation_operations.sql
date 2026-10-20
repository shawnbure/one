CREATE TABLE evaluation_suite_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  scenario_id TEXT NOT NULL REFERENCES evaluation_scenarios(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  release_id TEXT NOT NULL REFERENCES process_releases(id),
  evaluation_run_id TEXT,
  workflow_instance_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'regression' CHECK (mode IN ('regression','shadow')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','passing','failing','error')),
  score REAL,
  triggered_by TEXT NOT NULL,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE evaluation_human_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_result_id TEXT NOT NULL REFERENCES evaluation_case_results(id),
  reviewer_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  verdict TEXT NOT NULL CHECK (verdict IN ('acceptable','needs_work','unsafe')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (case_result_id, reviewer_id)
);

CREATE INDEX idx_evaluation_suites_scenario ON evaluation_suite_runs(tenant_id, scenario_id, created_at DESC);
CREATE INDEX idx_evaluation_suites_status ON evaluation_suite_runs(tenant_id, status, created_at DESC);
CREATE INDEX idx_evaluation_reviews_result ON evaluation_human_reviews(tenant_id, case_result_id);
