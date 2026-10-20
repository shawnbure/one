CREATE TABLE evaluation_rubric_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  criteria_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);

CREATE INDEX idx_evaluation_rubric_templates_tenant
  ON evaluation_rubric_templates(tenant_id, enabled, name);

INSERT INTO evaluation_rubric_templates
  (id, tenant_id, name, description, criteria_json, created_by)
SELECT
  'rubric-' || id || '-actionable',
  id,
  'Actionable operations response',
  'Checks that the response explains the operational risk and gives a practical next action.',
  '[{"criterion":"Identifies the operational risk using only the available facts.","dimension":"groundedness","weight":1},{"criterion":"Recommends a practical next action that an operator can perform.","dimension":"completeness","weight":1}]',
  'system'
FROM tenants;

INSERT INTO evaluation_rubric_templates
  (id, tenant_id, name, description, criteria_json, created_by)
SELECT
  'rubric-' || id || '-safe',
  id,
  'Safe customer communication',
  'Checks that external-facing language is safe, clear, and avoids unsupported claims.',
  '[{"criterion":"Avoids unsupported claims, invented actions, and disclosure of sensitive information.","dimension":"safety","weight":2},{"criterion":"Uses clear language appropriate for a business user.","dimension":"clarity","weight":1}]',
  'system'
FROM tenants;

INSERT INTO evaluation_rubric_templates
  (id, tenant_id, name, description, criteria_json, created_by)
SELECT
  'rubric-' || id || '-structured',
  id,
  'Structured handoff',
  'Checks that the response is complete enough for a downstream human or automated step.',
  '[{"criterion":"Includes the key facts, decision, and next owner needed for a reliable handoff.","dimension":"completeness","weight":2},{"criterion":"Follows the requested output structure without unnecessary content.","dimension":"format","weight":1}]',
  'system'
FROM tenants;
