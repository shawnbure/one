ALTER TABLE tool_invocations ADD COLUMN handler_key TEXT;

CREATE TABLE tool_action_dispatches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  approval_id TEXT NOT NULL REFERENCES approvals(id),
  execution_id TEXT NOT NULL REFERENCES executions(id),
  invocation_id TEXT NOT NULL REFERENCES tool_invocations(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','queued','processing','retrying','completed','failed','enqueue_failed','rejected')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_resource_id TEXT,
  last_error TEXT,
  approved_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enqueued_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, invocation_id)
);

CREATE INDEX tool_action_dispatch_status
  ON tool_action_dispatches(tenant_id, status, updated_at);

INSERT OR IGNORE INTO tool_definitions
  (id, tenant_id, name, description, adapter_kind, connection_id, handler_key, access_mode,
   risk_level, input_schema_json, output_schema_json, data_classification, owner,
   rate_limit_per_minute, support_instructions, created_by)
SELECT
  'tool-ms-calendar-create-' || t.id,
  t.id,
  'create_microsoft_calendar_event',
  'Create one event in the connected Microsoft 365 default calendar after human approval.',
  'microsoft',
  c.id,
  'microsoft.calendar.event.create',
  'write',
  'medium',
  '{"type":"object","additionalProperties":false,"required":["subject","start","end"],"properties":{"subject":{"type":"string","minLength":1,"maxLength":160},"start":{"type":"string","format":"date-time"},"end":{"type":"string","format":"date-time"},"timeZone":{"type":"string","maxLength":80},"location":{"type":"string","maxLength":160},"body":{"type":"string","maxLength":2000}}}',
  '{"type":"object","properties":{"id":{"type":"string"},"subject":{"type":"string"},"webLink":{"type":"string"}}}',
  'confidential',
  'Platform Administration',
  10,
  'Requires Calendars.ReadWrite. Every call is proposal-only until a reviewer approves it.',
  'migration'
FROM tenants t
JOIN connections c ON c.tenant_id=t.id AND c.name='Microsoft 365';

