CREATE TABLE dlp_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  detector TEXT NOT NULL CHECK (detector IN ('email','phone','ssn','payment_card','api_secret','ip_address')),
  label TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('audit','redact','block')),
  direction TEXT NOT NULL DEFAULT 'both' CHECK (direction IN ('input','output','both')),
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, detector)
);

CREATE TABLE dlp_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  execution_id TEXT,
  blueprint_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('input','output')),
  stage TEXT NOT NULL,
  detector TEXT NOT NULL,
  action TEXT NOT NULL,
  match_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dlp_events_tenant_created ON dlp_events(tenant_id, created_at DESC);
CREATE INDEX idx_dlp_events_execution ON dlp_events(tenant_id, execution_id);

INSERT INTO dlp_rules (id, tenant_id, detector, label, action, direction, enabled, updated_by)
  SELECT 'dlp-' || id || '-email', id, 'email', 'Email addresses', 'redact', 'both', 1, 'system' FROM tenants;
INSERT INTO dlp_rules (id, tenant_id, detector, label, action, direction, enabled, updated_by)
  SELECT 'dlp-' || id || '-phone', id, 'phone', 'Phone numbers', 'redact', 'both', 1, 'system' FROM tenants;
INSERT INTO dlp_rules (id, tenant_id, detector, label, action, direction, enabled, updated_by)
  SELECT 'dlp-' || id || '-ssn', id, 'ssn', 'US Social Security numbers', 'block', 'both', 1, 'system' FROM tenants;
INSERT INTO dlp_rules (id, tenant_id, detector, label, action, direction, enabled, updated_by)
  SELECT 'dlp-' || id || '-card', id, 'payment_card', 'Payment card numbers', 'block', 'both', 1, 'system' FROM tenants;
INSERT INTO dlp_rules (id, tenant_id, detector, label, action, direction, enabled, updated_by)
  SELECT 'dlp-' || id || '-secret', id, 'api_secret', 'API keys and secrets', 'block', 'both', 1, 'system' FROM tenants;
INSERT INTO dlp_rules (id, tenant_id, detector, label, action, direction, enabled, updated_by)
  SELECT 'dlp-' || id || '-ip', id, 'ip_address', 'IP addresses', 'audit', 'both', 1, 'system' FROM tenants;
