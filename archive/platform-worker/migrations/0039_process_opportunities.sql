CREATE TABLE process_opportunities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  business_owner TEXT NOT NULL,
  department TEXT NOT NULL,
  current_steps TEXT NOT NULL DEFAULT '',
  systems_json TEXT NOT NULL DEFAULT '[]',
  exceptions_json TEXT NOT NULL DEFAULT '[]',
  volume_per_month INTEGER NOT NULL DEFAULT 0 CHECK (volume_per_month >= 0),
  minutes_per_item REAL NOT NULL DEFAULT 0 CHECK (minutes_per_item >= 0),
  hourly_cost REAL NOT NULL DEFAULT 0 CHECK (hourly_cost >= 0),
  error_rate REAL NOT NULL DEFAULT 0 CHECK (error_rate >= 0 AND error_rate <= 1),
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high')),
  data_classification TEXT NOT NULL DEFAULT 'internal'
    CHECK (data_classification IN ('public','internal','confidential','restricted')),
  external_action INTEGER NOT NULL DEFAULT 0 CHECK (external_action IN (0,1)),
  human_judgment TEXT NOT NULL DEFAULT 'some' CHECK (human_judgment IN ('low','some','high')),
  impact_score INTEGER NOT NULL,
  feasibility_score INTEGER NOT NULL,
  priority_score INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'captured'
    CHECK (status IN ('captured','qualified','approved','declined','converted')),
  recommended_template_id TEXT REFERENCES process_templates(id),
  qualification_note TEXT,
  blueprint_id TEXT REFERENCES agent_blueprints(id),
  created_by TEXT NOT NULL,
  qualified_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  qualified_at TEXT,
  converted_at TEXT
);

CREATE INDEX idx_process_opportunities_tenant_priority
  ON process_opportunities(tenant_id, status, priority_score DESC, created_at DESC);

INSERT INTO process_opportunities
  (id, tenant_id, name, purpose, business_owner, department, current_steps, systems_json, exceptions_json,
   volume_per_month, minutes_per_item, hourly_cost, error_rate, risk_level, data_classification,
   external_action, human_judgment, impact_score, feasibility_score, priority_score, status,
   recommended_template_id, qualification_note, created_by, qualified_by, qualified_at)
SELECT
  'opportunity-vendor-intake', 'demo', 'Vendor invoice intake',
  'Reduce manual invoice keying while routing exceptions to finance.',
  'Finance Operations', 'Finance',
  'Open invoice; identify vendor; key fields; validate totals; route exception.',
  '["Shared mailbox","Accounting system"]', '["Unknown vendor","Total mismatch","Missing purchase order"]',
  420, 14, 46, 0.07, 'medium', 'confidential', 1, 'some', 69, 57, 64, 'qualified',
  'template-document-intake', 'Strong structured intake candidate; keep accounting writes approval-gated.',
  'system', 'system', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM tenants WHERE id='demo');
