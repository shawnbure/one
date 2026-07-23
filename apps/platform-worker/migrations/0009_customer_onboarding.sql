CREATE TABLE tenant_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  organization_name TEXT NOT NULL,
  support_email TEXT NOT NULL,
  accent_color TEXT NOT NULL DEFAULT '#1f7a5b',
  default_model_profile TEXT NOT NULL DEFAULT 'balanced',
  data_region TEXT NOT NULL DEFAULT 'Cloudflare global network',
  initialized_at TEXT,
  initialized_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tenant_settings
  (tenant_id, organization_name, support_email, accent_color, default_model_profile, initialized_at, initialized_by)
VALUES
  ('demo', 'Acme Operations', 'shawnbure@outlook.com', '#1f7a5b', 'balanced', CURRENT_TIMESTAMP, 'member-demo-admin');
