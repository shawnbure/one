CREATE TABLE business_value_measurements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  items_processed INTEGER NOT NULL CHECK (items_processed BETWEEN 1 AND 1000000),
  actual_human_minutes REAL NOT NULL CHECK (actual_human_minutes BETWEEN 0 AND 100000000),
  average_cycle_minutes REAL CHECK (average_cycle_minutes BETWEEN 0 AND 1000000),
  human_minutes_saved REAL NOT NULL CHECK (human_minutes_saved BETWEEN 0 AND 100000000),
  estimated_value REAL NOT NULL CHECK (estimated_value BETWEEN 0 AND 1000000000),
  override_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  evidence_reference TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  void_reason TEXT,
  voided_by TEXT,
  voided_at TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revision INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (blueprint_id) REFERENCES agent_blueprints(id),
  FOREIGN KEY (recorded_by) REFERENCES tenant_members(id),
  FOREIGN KEY (voided_by) REFERENCES tenant_members(id),
  CHECK (override_count BETWEEN 0 AND items_processed),
  CHECK (failure_count BETWEEN 0 AND items_processed),
  CHECK (date(period_start) <= date(period_end))
);

CREATE INDEX business_value_measurements_tenant_period
  ON business_value_measurements(tenant_id, status, period_end DESC, id);
CREATE INDEX business_value_measurements_process_period
  ON business_value_measurements(tenant_id, blueprint_id, status, period_end DESC);
