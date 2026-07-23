CREATE TABLE tenant_governance_reviews (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  review_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  cadence_days INTEGER NOT NULL CHECK (cadence_days BETWEEN 30 AND 365),
  next_due_at TEXT NOT NULL,
  last_completed_at TEXT,
  last_completed_by TEXT,
  evidence_reference TEXT,
  completion_notes TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, review_key)
);

CREATE INDEX idx_tenant_governance_reviews_due
  ON tenant_governance_reviews(tenant_id, next_due_at);

INSERT INTO tenant_governance_reviews
  (tenant_id, review_key, name, description, cadence_days, next_due_at)
SELECT t.id, v.review_key, v.name, v.description, v.cadence_days,
  datetime(CURRENT_TIMESTAMP, '+' || v.cadence_days || ' days')
FROM tenants t CROSS JOIN (
  SELECT 'privacy_architecture' review_key, 'Privacy and architecture' name,
    'Confirm data flows, storage, retention, external destinations, and customer ownership.' description, 90 cadence_days
  UNION ALL SELECT 'model_inventory', 'AI model inventory',
    'Confirm every approved and deployed model remains authorized for organizational use.', 90
  UNION ALL SELECT 'access_roles', 'Access and role review',
    'Confirm active members, service principals, delegated approvers, and least privilege.', 90
  UNION ALL SELECT 'incident_recovery', 'Incident and recovery readiness',
    'Review incidents, recovery ownership, maintenance evidence, and the customer runbook.', 90
) v;
