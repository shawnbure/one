CREATE TABLE process_threads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  created_by TEXT NOT NULL REFERENCES tenant_members(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  last_execution_id TEXT REFERENCES executions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX process_threads_owner_updated
  ON process_threads(tenant_id, created_by, status, updated_at DESC);

CREATE INDEX process_threads_process_owner
  ON process_threads(tenant_id, blueprint_id, created_by, updated_at DESC);
