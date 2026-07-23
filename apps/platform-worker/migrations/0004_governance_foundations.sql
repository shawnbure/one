CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy','attention','disconnected')),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('read','write','read_write')),
  scopes_json TEXT NOT NULL DEFAULT '[]',
  secret_configured INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE knowledge_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  owner TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready','indexing','stale','error')),
  provenance TEXT NOT NULL,
  allowed_processes_json TEXT NOT NULL DEFAULT '[]',
  reviewed_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE evaluation_scenarios (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passing','failing','not_run')),
  assertion_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE retention_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  data_class TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  deletion_mode TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

INSERT INTO connections (id, tenant_id, name, kind, owner, status, access_mode, scopes_json, secret_configured, last_checked_at) VALUES
 ('conn-workers-ai', 'demo', 'Cloudflare Workers AI', 'model_provider', 'Platform Administration', 'healthy', 'read_write', '["model:invoke"]', 1, CURRENT_TIMESTAMP),
 ('conn-customer-records', 'demo', 'Customer Records', 'typed_http', 'Customer Operations', 'healthy', 'read', '["customers:read","contracts:read"]', 1, CURRENT_TIMESTAMP),
 ('conn-outbound-email', 'demo', 'Outbound Email', 'email', 'Customer Operations', 'attention', 'write', '["email:send"]', 0, NULL);

INSERT INTO knowledge_sources (id, tenant_id, name, source_type, owner, sensitivity, status, provenance, allowed_processes_json, reviewed_at, expires_at) VALUES
 ('knowledge-service-policy', 'demo', 'Customer Service Policy', 'document', 'Customer Operations', 'internal', 'ready', 'Approved operations handbook v3', '["customer-ops","inbox-triage"]', CURRENT_TIMESTAMP, datetime('now','+90 days')),
 ('knowledge-renewal-playbook', 'demo', 'Renewal Playbook', 'document', 'Revenue Operations', 'confidential', 'ready', 'Revenue Operations approved playbook', '["renewal-review"]', CURRENT_TIMESTAMP, datetime('now','+60 days'));

INSERT INTO evaluation_scenarios (id, tenant_id, blueprint_id, name, category, status, assertion_count, last_run_at) VALUES
 ('eval-inbox-route', 'demo', 'inbox-triage', 'Routes an urgent service request', 'routing', 'passing', 4, CURRENT_TIMESTAMP),
 ('eval-customer-approval', 'demo', 'customer-ops', 'External message requires approval', 'policy', 'passing', 5, CURRENT_TIMESTAMP),
 ('eval-renewal-price', 'demo', 'renewal-review', 'Never changes contract price', 'guardrail', 'passing', 3, CURRENT_TIMESTAMP);

INSERT INTO retention_policies (id, tenant_id, name, data_class, retention_days, deletion_mode) VALUES
 ('retention-operational', 'demo', 'Operational records', 'internal', 365, 'scheduled_delete'),
 ('retention-conversation', 'demo', 'Agent conversations', 'confidential', 90, 'agent_and_audit_delete');
