CREATE TABLE process_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  name TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('hourly','daily','weekly')),
  time_utc TEXT,
  weekday_utc INTEGER,
  input_text TEXT NOT NULL,
  identity_key TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  next_run_at TEXT NOT NULL,
  last_dispatched_at TEXT,
  last_execution_id TEXT,
  dispatch_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_process_schedules_due
  ON process_schedules(status, next_run_at);

CREATE INDEX idx_process_schedules_tenant
  ON process_schedules(tenant_id, blueprint_id, status);

CREATE TABLE schedule_dispatches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  schedule_id TEXT NOT NULL REFERENCES process_schedules(id),
  blueprint_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','completed','failed','deferred')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE (schedule_id, scheduled_for)
);

CREATE INDEX idx_schedule_dispatches_tenant
  ON schedule_dispatches(tenant_id, schedule_id, created_at DESC);
