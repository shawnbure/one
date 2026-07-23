ALTER TABLE evaluation_runs ADD COLUMN model_profile TEXT;
ALTER TABLE evaluation_cases ADD COLUMN redaction_json TEXT NOT NULL DEFAULT '{"count":0,"types":[]}';

UPDATE evaluation_runs
SET model_profile = (
  SELECT model_profile FROM process_releases WHERE process_releases.id = evaluation_runs.release_id
)
WHERE model_profile IS NULL;

CREATE TABLE evaluation_model_trials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  scenario_id TEXT NOT NULL REFERENCES evaluation_scenarios(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  release_id TEXT NOT NULL REFERENCES process_releases(id),
  workflow_instance_id TEXT NOT NULL,
  baseline_profile TEXT NOT NULL,
  candidate_profile TEXT NOT NULL,
  baseline_run_id TEXT NOT NULL,
  candidate_run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','error')),
  baseline_score REAL,
  candidate_score REAL,
  baseline_cost_usd REAL,
  candidate_cost_usd REAL,
  baseline_tokens INTEGER,
  candidate_tokens INTEGER,
  recommendation TEXT,
  triggered_by TEXT NOT NULL,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_evaluation_model_trials_scenario
  ON evaluation_model_trials(tenant_id, scenario_id, created_at DESC);
