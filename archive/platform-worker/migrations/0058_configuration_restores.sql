CREATE TABLE configuration_restores (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  package_checksum TEXT NOT NULL,
  source_environment TEXT,
  source_tenant_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('applied')),
  section_counts_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  applied_by TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_configuration_restores_tenant_applied
  ON configuration_restores(tenant_id, applied_at DESC);
