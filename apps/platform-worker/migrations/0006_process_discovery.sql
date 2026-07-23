CREATE TABLE process_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  execution_profile TEXT NOT NULL,
  model_profile TEXT NOT NULL,
  autonomy TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  instructions_json TEXT NOT NULL DEFAULT '[]',
  guardrails_json TEXT NOT NULL DEFAULT '[]',
  tools_json TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL
);

CREATE TABLE process_discovery (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  purpose TEXT NOT NULL,
  current_steps TEXT NOT NULL DEFAULT '',
  systems_json TEXT NOT NULL DEFAULT '[]',
  exceptions_json TEXT NOT NULL DEFAULT '[]',
  volume_per_month INTEGER NOT NULL DEFAULT 0,
  minutes_per_item REAL NOT NULL DEFAULT 0,
  hourly_cost REAL NOT NULL DEFAULT 0,
  error_rate REAL NOT NULL DEFAULT 0,
  opportunity_score INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT
);

CREATE TABLE value_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  period_start TEXT NOT NULL,
  items_processed INTEGER NOT NULL DEFAULT 0,
  human_minutes_saved REAL NOT NULL DEFAULT 0,
  estimated_value REAL NOT NULL DEFAULT 0,
  override_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO process_templates VALUES
 ('template-customer-ops', 'Customer request triage and response', 'Classify inbound customer requests, draft a response, and require approval before external communication.', 'conversation', 'balanced', 'approve', 'You are a private customer operations assistant. Use verified context and prepare clear next actions.', '["Classify the request","Use supplied customer context","Draft a concise response"]', '["Never send an external message without required approval","Do not invent customer facts"]', '["lookup_customer","draft_reply"]', 'Customer operations'),
 ('template-document-intake', 'Document intake and extraction', 'Extract structured fields, validate required information, and route exceptions to an operator.', 'workflow', 'fast', 'suggest', 'You process business documents into validated structured records.', '["Extract only supported fields","Flag missing or conflicting values"]', '["Preserve source provenance","Never infer sensitive values"]', '["extract_document","validate_fields","create_task"]', 'Operations'),
 ('template-knowledge-assistant', 'Internal knowledge assistant', 'Answer employee questions from approved sources with citations and escalation.', 'conversation', 'balanced', 'suggest', 'You answer internal questions using only approved organizational knowledge.', '["Cite the supporting source","State when evidence is insufficient"]', '["Do not expose sources outside the user permission scope"]', '["search_knowledge","create_escalation"]', 'Knowledge');

INSERT INTO process_discovery
  (id, tenant_id, blueprint_id, purpose, current_steps, systems_json, exceptions_json, volume_per_month, minutes_per_item, hourly_cost, error_rate, opportunity_score, created_by, approved_at)
VALUES
 ('discovery-customer-ops', 'demo', 'customer-ops', 'Reduce response preparation time while preserving human approval.', 'Review request; locate customer context; draft response; obtain approval; send.', '["Customer Records","Email"]', '["Contract changes","Pricing exceptions"]', 850, 12, 42, 0.06, 82, 'system', CURRENT_TIMESTAMP),
 ('discovery-inbox-triage', 'demo', 'inbox-triage', 'Route inbound work consistently and reduce manual sorting.', 'Read request; classify urgency; identify owner; create task.', '["Inbox","Task system"]', '["Unknown customer","Security request"]', 1400, 4, 35, 0.08, 88, 'system', CURRENT_TIMESTAMP),
 ('discovery-renewal-review', 'demo', 'renewal-review', 'Prepare consistent renewal risk briefs before account-owner review.', 'Gather contract; review usage; score risk; draft brief.', '["Contracts","Customer Records"]', '["Non-standard pricing","Legal hold"]', 90, 55, 55, 0.04, 74, 'system', CURRENT_TIMESTAMP);

INSERT INTO value_snapshots (id, tenant_id, blueprint_id, period_start, items_processed, human_minutes_saved, estimated_value, override_count, failure_count) VALUES
 ('value-customer-ops', 'demo', 'customer-ops', date('now','-7 days'), 642, 1542, 1079.40, 18, 3),
 ('value-inbox-triage', 'demo', 'inbox-triage', date('now','-7 days'), 511, 1022, 596.17, 9, 2),
 ('value-renewal-review', 'demo', 'renewal-review', date('now','-7 days'), 131, 619, 567.42, 7, 1);
