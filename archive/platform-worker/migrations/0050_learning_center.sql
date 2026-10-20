CREATE TABLE learning_acknowledgements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  module_version INTEGER NOT NULL,
  acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, actor_id, module_id, module_version)
);

CREATE INDEX idx_learning_acknowledgements_actor
  ON learning_acknowledgements(tenant_id, actor_id, acknowledged_at DESC);
