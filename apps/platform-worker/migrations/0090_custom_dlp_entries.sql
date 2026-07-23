CREATE TABLE custom_dlp_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  label TEXT NOT NULL,
  term_ciphertext TEXT NOT NULL,
  term_iv TEXT NOT NULL,
  term_digest TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('audit','redact','block')),
  direction TEXT NOT NULL DEFAULT 'both' CHECK (direction IN ('input','output','both')),
  enabled INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, term_digest)
);

CREATE INDEX idx_custom_dlp_entries_tenant
  ON custom_dlp_entries(tenant_id, enabled, updated_at DESC);
