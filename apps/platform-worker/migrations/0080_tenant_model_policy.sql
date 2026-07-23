CREATE TABLE tenant_model_policies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  model_id TEXT NOT NULL REFERENCES model_catalog(model_id),
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, model_id)
);

CREATE INDEX idx_tenant_model_policies_enabled
  ON tenant_model_policies(tenant_id, enabled, model_id);

INSERT INTO tenant_model_policies (tenant_id, model_id, enabled, updated_by)
SELECT t.id, m.model_id, 1, 'system-migration'
FROM tenants t CROSS JOIN model_catalog m
WHERE m.status='active';
