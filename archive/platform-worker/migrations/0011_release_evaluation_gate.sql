ALTER TABLE process_releases ADD COLUMN evaluation_status TEXT NOT NULL DEFAULT 'not_run';
ALTER TABLE process_releases ADD COLUMN evaluated_at TEXT;

INSERT INTO evaluation_scenarios (id, tenant_id, blueprint_id, name, category, status, assertion_count)
SELECT 'eval-release-' || b.id, b.tenant_id, b.id, 'Release safety baseline', 'release_gate', 'not_run', 4
FROM agent_blueprints b
WHERE NOT EXISTS (SELECT 1 FROM evaluation_scenarios e WHERE e.tenant_id = b.tenant_id AND e.blueprint_id = b.id);
