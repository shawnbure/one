CREATE TABLE opportunity_readiness_checks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  opportunity_id TEXT NOT NULL REFERENCES process_opportunities(id),
  check_key TEXT NOT NULL,
  label TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('conversion','release')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','not_applicable')),
  evidence TEXT,
  owner_id TEXT,
  due_at TEXT,
  updated_by TEXT,
  updated_at TEXT,
  confirmed_at TEXT,
  UNIQUE (tenant_id, opportunity_id, check_key)
);

CREATE INDEX idx_opportunity_readiness_stage
  ON opportunity_readiness_checks(tenant_id, opportunity_id, stage, status);

WITH checks(check_key, label, stage) AS (
  VALUES
    ('owner_confirmed', 'Business owner confirmed', 'conversion'),
    ('current_state_validated', 'Current process and baseline validated', 'conversion'),
    ('data_classification_confirmed', 'Data classification confirmed', 'conversion'),
    ('target_outcome_approved', 'Target outcome approved', 'conversion'),
    ('systems_owner_identified', 'Authoritative systems and owners identified', 'release'),
    ('exceptions_defined', 'Exceptions and stop conditions defined', 'release'),
    ('acceptance_examples_available', 'Acceptance examples and prohibited outcomes available', 'release'),
    ('support_owner_assigned', 'Operational support owner and escalation path assigned', 'release')
)
INSERT INTO opportunity_readiness_checks
  (id, tenant_id, opportunity_id, check_key, label, stage, status)
SELECT 'readiness-' || o.id || '-' || checks.check_key, o.tenant_id, o.id,
  checks.check_key, checks.label, checks.stage, 'open'
FROM process_opportunities o CROSS JOIN checks;

UPDATE opportunity_readiness_checks
SET status='confirmed',
    evidence='Seed discovery evidence confirmed for the development reference candidate.',
    owner_id='member-demo-admin',
    updated_by='system',
    updated_at=CURRENT_TIMESTAMP,
    confirmed_at=CURRENT_TIMESTAMP
WHERE tenant_id='demo' AND opportunity_id='opportunity-vendor-intake' AND stage='conversion';

