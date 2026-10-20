CREATE TABLE tenant_handoff_checks (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  check_id TEXT NOT NULL CHECK (check_id IN (
    'customer_acceptance',
    'data_owner_approval',
    'operator_training',
    'support_handoff',
    'recovery_exercise'
  )),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed')),
  evidence TEXT,
  confirmed_by TEXT REFERENCES tenant_members(id),
  confirmed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, check_id),
  CHECK (
    (status = 'open' AND confirmed_by IS NULL AND confirmed_at IS NULL) OR
    (status = 'confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL
      AND LENGTH(TRIM(COALESCE(evidence, ''))) >= 10)
  )
);

CREATE INDEX tenant_handoff_checks_status
  ON tenant_handoff_checks(tenant_id, status, updated_at DESC);
