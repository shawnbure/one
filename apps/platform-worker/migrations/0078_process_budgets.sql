CREATE TABLE process_budgets (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  monthly_limit_usd REAL NOT NULL,
  warning_percent INTEGER NOT NULL DEFAULT 80,
  hard_limit INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id, blueprint_id)
);

CREATE INDEX idx_process_budgets_tenant
  ON process_budgets(tenant_id, updated_at DESC);
