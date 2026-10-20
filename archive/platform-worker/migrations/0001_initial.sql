PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_blueprints (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  execution_profile TEXT NOT NULL CHECK (execution_profile IN ('conversation','consumer','entity','shared_shard','temporary_durable','instant','workflow')),
  model_profile TEXT NOT NULL DEFAULT 'balanced',
  prompt_release_id TEXT,
  autonomy TEXT NOT NULL DEFAULT 'suggest' CHECK (autonomy IN ('observe','suggest','approve','guarded','autonomous')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','testing','active','paused')),
  tools_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prompt_releases (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  version INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  instructions_json TEXT NOT NULL DEFAULT '[]',
  guardrails_json TEXT NOT NULL DEFAULT '[]',
  checksum TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (blueprint_id, version)
);

CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  instance_key TEXT,
  execution_profile TEXT NOT NULL,
  status TEXT NOT NULL,
  input_preview TEXT NOT NULL,
  output_preview TEXT,
  model TEXT,
  idempotency_key TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error TEXT,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX executions_blueprint_started ON executions(blueprint_id, started_at DESC);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  execution_id TEXT NOT NULL REFERENCES executions(id),
  action_name TEXT NOT NULL,
  action_input_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  decided_by TEXT
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tenants (id, name) VALUES ('demo', 'Acme Operations');
INSERT INTO agent_blueprints (id, tenant_id, name, description, execution_profile, model_profile, prompt_release_id, autonomy, status, tools_json)
VALUES
 ('inbox-triage', 'demo', 'Inbox Triage', 'Classifies requests and routes work to the right owner.', 'instant', 'fast', 'prompt-inbox-v1', 'suggest', 'active', '["create_task"]'),
 ('customer-ops', 'demo', 'Customer Operations', 'Maintains a durable customer conversation with approved business actions.', 'conversation', 'balanced', 'prompt-customer-v1', 'approve', 'active', '["lookup_customer","draft_reply","update_crm"]'),
 ('renewal-review', 'demo', 'Renewal Review', 'Coordinates the multi-step renewal preparation and approval process.', 'workflow', 'reasoning', 'prompt-renewal-v1', 'approve', 'testing', '["lookup_contract","score_risk","draft_brief"]');
INSERT INTO prompt_releases (id, blueprint_id, version, system_prompt, instructions_json, guardrails_json, checksum)
VALUES
 ('prompt-inbox-v1', 'inbox-triage', 1, 'You are an operations intake specialist. Return a concise classification and recommended owner.', '["Use only supplied facts","Prefer a single clear route"]', '["Do not invent customer data"]', 'demo-inbox-v1'),
 ('prompt-customer-v1', 'customer-ops', 1, 'You are a private customer operations assistant. Be concise, accurate, and action-oriented.', '["Retain context within this customer thread","State uncertainty"]', '["Never execute a consequential action without policy approval"]', 'demo-customer-v1'),
 ('prompt-renewal-v1', 'renewal-review', 1, 'You prepare renewal briefs for account owners using verified company information.', '["Summarize risk and next actions"]', '["Never change a contract or price"]', 'demo-renewal-v1');
