CREATE TABLE process_solution_pack_handoff_checks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id) ON DELETE CASCADE,
  check_order INTEGER NOT NULL CHECK (check_order BETWEEN 1 AND 20),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','complete','not_applicable')),
  evidence TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  completed_by TEXT REFERENCES tenant_members(id),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, blueprint_id, check_order)
);

CREATE INDEX idx_solution_pack_handoff_process
  ON process_solution_pack_handoff_checks (tenant_id, blueprint_id, check_order);
