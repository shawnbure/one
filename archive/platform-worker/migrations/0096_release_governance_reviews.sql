CREATE TABLE process_release_governance_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  release_id TEXT NOT NULL REFERENCES process_releases(id),
  release_checksum TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  evidence TEXT NOT NULL,
  decided_by TEXT NOT NULL REFERENCES tenant_members(id),
  decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, release_id)
);

CREATE INDEX process_release_governance_reviews_process
  ON process_release_governance_reviews(tenant_id, blueprint_id, decided_at DESC);

