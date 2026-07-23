CREATE TABLE billing_reconciliations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('cloudflare_dashboard','cloudflare_invoice','cloudflare_api','other')),
  source_reference TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  workers_ai_neurons REAL CHECK (workers_ai_neurons IS NULL OR workers_ai_neurons >= 0),
  workers_ai_cost_usd REAL NOT NULL CHECK (workers_ai_cost_usd >= 0),
  platform_cost_usd REAL CHECK (platform_cost_usd IS NULL OR platform_cost_usd >= 0),
  workers_requests INTEGER CHECK (workers_requests IS NULL OR workers_requests >= 0),
  d1_rows_read INTEGER CHECK (d1_rows_read IS NULL OR d1_rows_read >= 0),
  d1_rows_written INTEGER CHECK (d1_rows_written IS NULL OR d1_rows_written >= 0),
  queue_operations INTEGER CHECK (queue_operations IS NULL OR queue_operations >= 0),
  workflow_wall_time_ms INTEGER CHECK (workflow_wall_time_ms IS NULL OR workflow_wall_time_ms >= 0),
  workrr_estimated_ai_cost_usd REAL NOT NULL,
  variance_usd REAL NOT NULL,
  variance_percent REAL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_by TEXT,
  voided_at TEXT,
  void_reason TEXT,
  UNIQUE (tenant_id, checksum)
);

CREATE INDEX idx_billing_reconciliation_tenant_period
  ON billing_reconciliations(tenant_id, period_end DESC, imported_at DESC);
