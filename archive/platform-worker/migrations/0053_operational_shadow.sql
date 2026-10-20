CREATE TABLE execution_shadow_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed')),
  verdict TEXT CHECK (verdict IN ('match', 'partial', 'miss', 'unsafe')),
  actual_outcome TEXT,
  note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, execution_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (execution_id) REFERENCES executions(id),
  FOREIGN KEY (blueprint_id) REFERENCES agent_blueprints(id),
  FOREIGN KEY (reviewed_by) REFERENCES tenant_members(id)
);

CREATE INDEX idx_shadow_reviews_tenant_status_created
  ON execution_shadow_reviews(tenant_id, status, created_at DESC);
CREATE INDEX idx_shadow_reviews_process_created
  ON execution_shadow_reviews(tenant_id, blueprint_id, created_at DESC);
