CREATE TABLE rubric_publisher_trust (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  publisher_name TEXT NOT NULL,
  publisher_key_id TEXT NOT NULL,
  public_key_x TEXT NOT NULL,
  policy TEXT NOT NULL DEFAULT 'manual' CHECK (policy IN ('manual','auto_approve','block')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, publisher_key_id)
);

CREATE INDEX idx_rubric_publisher_trust_tenant
  ON rubric_publisher_trust(tenant_id, status, policy);
