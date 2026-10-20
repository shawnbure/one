ALTER TABLE agent_blueprints ADD COLUMN business_owner TEXT NOT NULL DEFAULT 'Operations';
ALTER TABLE agent_blueprints ADD COLUMN department TEXT NOT NULL DEFAULT 'Operations';
ALTER TABLE agent_blueprints ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE agent_blueprints ADD COLUMN operating_mode TEXT NOT NULL DEFAULT 'active';
ALTER TABLE agent_blueprints ADD COLUMN active_release_id TEXT;

ALTER TABLE prompt_releases ADD COLUMN status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE prompt_releases ADD COLUMN release_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_releases ADD COLUMN created_by TEXT;

CREATE TABLE process_releases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  version INTEGER NOT NULL,
  prompt_release_id TEXT NOT NULL REFERENCES prompt_releases(id),
  model_profile TEXT NOT NULL,
  autonomy TEXT NOT NULL,
  compiled_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  release_notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  published_by TEXT,
  UNIQUE (tenant_id, blueprint_id, version)
);

CREATE INDEX process_releases_blueprint_version ON process_releases(blueprint_id, version DESC);

INSERT INTO process_releases
  (id, tenant_id, blueprint_id, version, prompt_release_id, model_profile, autonomy, compiled_json, checksum, status, release_notes, created_by, published_at, published_by)
SELECT
  'release-' || b.id || '-v1', b.tenant_id, b.id, 1, b.prompt_release_id, b.model_profile, b.autonomy,
  json_object('promptReleaseId', b.prompt_release_id, 'modelProfile', b.model_profile, 'autonomy', b.autonomy, 'executionProfile', b.execution_profile),
  'initial-' || b.id || '-v1', 'published', 'Initial platform release', 'system', CURRENT_TIMESTAMP, 'system'
FROM agent_blueprints b;

UPDATE agent_blueprints SET active_release_id = 'release-' || id || '-v1';
