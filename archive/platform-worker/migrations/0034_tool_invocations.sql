CREATE TABLE tool_invocations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  execution_id TEXT NOT NULL REFERENCES executions(id),
  tool_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_version INTEGER NOT NULL,
  tool_call_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('simulated','proposed','completed','failed','denied')),
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('simulation','proposal_only','bound')),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('read','write')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  adapter_kind TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error TEXT,
  idempotency_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (tenant_id, execution_id, tool_call_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX tool_invocations_execution
  ON tool_invocations(tenant_id, execution_id, started_at);
