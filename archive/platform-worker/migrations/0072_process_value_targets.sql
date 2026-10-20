CREATE TABLE process_value_targets (
  tenant_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  target_items INTEGER NOT NULL CHECK (target_items BETWEEN 1 AND 1000000),
  target_human_minutes_saved REAL NOT NULL CHECK (target_human_minutes_saved BETWEEN 0 AND 100000000),
  target_value REAL NOT NULL CHECK (target_value BETWEEN 0 AND 1000000000),
  maximum_override_percent REAL NOT NULL CHECK (maximum_override_percent BETWEEN 0 AND 100),
  maximum_failure_percent REAL NOT NULL CHECK (maximum_failure_percent BETWEEN 0 AND 100),
  review_due_at TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, blueprint_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (blueprint_id) REFERENCES agent_blueprints(id),
  FOREIGN KEY (updated_by) REFERENCES tenant_members(id)
);

CREATE INDEX process_value_targets_review
  ON process_value_targets(tenant_id, review_due_at, blueprint_id);

INSERT INTO process_value_targets
  (tenant_id, blueprint_id, target_items, target_human_minutes_saved, target_value,
   maximum_override_percent, maximum_failure_percent, review_due_at, rationale,
   evidence_reference, updated_by)
SELECT 'demo', 'customer-ops', 700, 1680, 1176, 5, 5, datetime('now','+90 days'),
  'Expand governed customer operations throughput while preserving human exception controls.',
  'demo-operating-plan', 'member-demo-admin'
WHERE EXISTS (SELECT 1 FROM tenant_members WHERE id='member-demo-admin' AND tenant_id='demo');

INSERT INTO process_value_targets
  (tenant_id, blueprint_id, target_items, target_human_minutes_saved, target_value,
   maximum_override_percent, maximum_failure_percent, review_due_at, rationale,
   evidence_reference, updated_by)
SELECT 'demo', 'inbox-triage', 600, 1200, 700, 5, 5, datetime('now','+90 days'),
  'Increase triage coverage while maintaining a bounded exception rate.',
  'demo-operating-plan', 'member-demo-admin'
WHERE EXISTS (SELECT 1 FROM tenant_members WHERE id='member-demo-admin' AND tenant_id='demo');

INSERT INTO process_value_targets
  (tenant_id, blueprint_id, target_items, target_human_minutes_saved, target_value,
   maximum_override_percent, maximum_failure_percent, review_due_at, rationale,
   evidence_reference, updated_by)
SELECT 'demo', 'renewal-review', 150, 720, 660, 8, 5, datetime('now','+90 days'),
  'Prove renewal preparation value before expanding the workflow.',
  'demo-operating-plan', 'member-demo-admin'
WHERE EXISTS (SELECT 1 FROM tenant_members WHERE id='member-demo-admin' AND tenant_id='demo');
