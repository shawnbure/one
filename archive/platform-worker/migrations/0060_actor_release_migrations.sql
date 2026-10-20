CREATE TABLE actor_release_migrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  source_execution_id TEXT NOT NULL,
  from_release_id TEXT NOT NULL,
  to_release_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  migrated_by TEXT NOT NULL,
  migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (blueprint_id) REFERENCES agent_blueprints(id),
  FOREIGN KEY (from_release_id) REFERENCES process_releases(id),
  FOREIGN KEY (to_release_id) REFERENCES process_releases(id)
);

CREATE INDEX idx_actor_release_migrations_actor
  ON actor_release_migrations(tenant_id, blueprint_id, instance_key, migrated_at DESC);
