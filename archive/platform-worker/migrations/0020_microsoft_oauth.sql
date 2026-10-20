CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_id TEXT NOT NULL REFERENCES tenant_members(id),
  provider TEXT NOT NULL CHECK (provider IN ('microsoft')),
  verifier_ciphertext TEXT NOT NULL,
  verifier_iv TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE oauth_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  connection_id TEXT NOT NULL REFERENCES connections(id),
  provider TEXT NOT NULL CHECK (provider IN ('microsoft')),
  provider_tenant_id TEXT,
  provider_subject TEXT,
  account_email TEXT,
  account_name TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  token_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','attention','disconnected')),
  last_checked_at TEXT,
  last_error TEXT,
  connected_by TEXT NOT NULL REFERENCES tenant_members(id),
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, provider)
);

CREATE INDEX idx_oauth_states_expiry ON oauth_states(expires_at, used_at);
CREATE INDEX idx_oauth_connections_tenant ON oauth_connections(tenant_id, status);

INSERT OR IGNORE INTO connections
  (id, tenant_id, name, kind, owner, status, access_mode, scopes_json, secret_configured)
VALUES
  ('conn-microsoft-365', 'demo', 'Microsoft 365', 'oauth', 'Platform Administration',
   'disconnected', 'read', '["User.Read","Mail.ReadBasic","Calendars.ReadBasic"]', 0);
