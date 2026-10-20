ALTER TABLE evaluation_scenarios ADD COLUMN gate_threshold REAL NOT NULL DEFAULT 1.0;
ALTER TABLE evaluation_runs ADD COLUMN score REAL NOT NULL DEFAULT 0;
ALTER TABLE evaluation_runs ADD COLUMN case_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE evaluation_runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE evaluation_runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE evaluation_runs ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE evaluation_runs ADD COLUMN estimated_cost_usd REAL NOT NULL DEFAULT 0;

CREATE TABLE evaluation_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  scenario_id TEXT NOT NULL REFERENCES evaluation_scenarios(id),
  name TEXT NOT NULL,
  input_text TEXT NOT NULL,
  assertions_json TEXT NOT NULL DEFAULT '[]',
  weight REAL NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'curated',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scenario_id, name)
);

CREATE TABLE evaluation_case_results (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  run_id TEXT NOT NULL REFERENCES evaluation_runs(id),
  case_id TEXT NOT NULL REFERENCES evaluation_cases(id),
  release_id TEXT NOT NULL REFERENCES process_releases(id),
  status TEXT NOT NULL CHECK (status IN ('passing','failing','error')),
  passed_assertions INTEGER NOT NULL,
  assertion_count INTEGER NOT NULL,
  output_preview TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_evaluation_cases_scenario ON evaluation_cases(tenant_id, scenario_id, enabled);
CREATE INDEX idx_evaluation_case_results_run ON evaluation_case_results(run_id, case_id);
CREATE INDEX idx_evaluation_case_results_tenant_created ON evaluation_case_results(tenant_id, created_at DESC);

INSERT OR IGNORE INTO evaluation_cases
  (id, tenant_id, scenario_id, name, input_text, assertions_json, source)
SELECT
  'case-golden-' || e.id,
  e.tenant_id,
  e.id,
  'Concise grounded response',
  'Prepare a concise response using only the supplied facts. Facts: the request is incomplete and requires an operator to provide the missing account identifier.',
  '[{"type":"max_chars","value":2000},{"type":"contains_any","value":["missing","incomplete","identifier","operator"]},{"type":"not_contains_any","value":["I looked up","I accessed your system"]}]',
  'platform_seed'
FROM evaluation_scenarios e;

UPDATE evaluation_scenarios SET assertion_count = 7 WHERE assertion_count < 7;
