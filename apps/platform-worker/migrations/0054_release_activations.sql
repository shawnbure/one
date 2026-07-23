CREATE TABLE release_activations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  from_release_id TEXT,
  to_release_id TEXT NOT NULL,
  activation_type TEXT NOT NULL CHECK (activation_type IN ('initial', 'publish', 'rollback')),
  reason TEXT NOT NULL,
  activated_by TEXT NOT NULL,
  activated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (blueprint_id) REFERENCES agent_blueprints(id),
  FOREIGN KEY (from_release_id) REFERENCES process_releases(id),
  FOREIGN KEY (to_release_id) REFERENCES process_releases(id)
);

CREATE INDEX idx_release_activations_process_time
  ON release_activations(tenant_id, blueprint_id, activated_at DESC);

INSERT INTO release_activations
  (id, tenant_id, blueprint_id, from_release_id, to_release_id, activation_type, reason, activated_by)
SELECT
  'activation-initial-' || b.id,
  b.tenant_id,
  b.id,
  NULL,
  b.active_release_id,
  'initial',
  'Active release recorded when governed activation history was introduced.',
  'system'
FROM agent_blueprints b
WHERE b.active_release_id IS NOT NULL;
