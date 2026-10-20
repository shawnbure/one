ALTER TABLE process_opportunities ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE opportunity_revisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  opportunity_id TEXT NOT NULL REFERENCES process_opportunities(id),
  revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  change_reason TEXT,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, opportunity_id, revision)
);

CREATE INDEX idx_opportunity_revisions_history
  ON opportunity_revisions(tenant_id, opportunity_id, revision DESC);

INSERT INTO opportunity_revisions
  (id, tenant_id, opportunity_id, revision, snapshot_json, change_reason, changed_by, created_at)
SELECT 'opportunity-revision-' || id || '-1', tenant_id, id, 1,
  json_object(
    'name', name, 'purpose', purpose, 'businessOwner', business_owner, 'department', department,
    'currentSteps', current_steps, 'systems', json(systems_json), 'exceptions', json(exceptions_json),
    'volumePerMonth', volume_per_month, 'minutesPerItem', minutes_per_item, 'hourlyCost', hourly_cost,
    'errorRate', error_rate, 'riskLevel', risk_level, 'dataClassification', data_classification,
    'externalAction', json(CASE external_action WHEN 1 THEN 'true' ELSE 'false' END),
    'humanJudgment', human_judgment, 'recommendedTemplateId', recommended_template_id,
    'impactScore', impact_score, 'feasibilityScore', feasibility_score, 'priorityScore', priority_score,
    'status', status
  ),
  'Initial captured evidence', created_by, created_at
FROM process_opportunities;

