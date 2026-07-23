CREATE TABLE access_service_principals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  access_common_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  UNIQUE (access_common_name)
);

CREATE INDEX idx_access_service_principals_common_name
  ON access_service_principals(access_common_name, status);

CREATE TABLE smoke_fixtures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  created_by TEXT NOT NULL,
  label TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_smoke_fixtures_tenant_expiry
  ON smoke_fixtures(tenant_id, expires_at);
