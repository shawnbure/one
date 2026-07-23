CREATE TABLE actor_release_rollouts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  target_release_id TEXT NOT NULL,
  percentage INTEGER NOT NULL CHECK (percentage BETWEEN 1 AND 100),
  selected_actor_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
  completed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  workflow_instance_id TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (blueprint_id) REFERENCES agent_blueprints(id),
  FOREIGN KEY (target_release_id) REFERENCES process_releases(id)
);

CREATE TABLE actor_release_rollout_items (
  id TEXT PRIMARY KEY,
  rollout_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  source_execution_id TEXT NOT NULL,
  from_release_id TEXT NOT NULL,
  to_release_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'skipped', 'failed')),
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (rollout_id) REFERENCES actor_release_rollouts(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (blueprint_id) REFERENCES agent_blueprints(id),
  FOREIGN KEY (from_release_id) REFERENCES process_releases(id),
  FOREIGN KEY (to_release_id) REFERENCES process_releases(id),
  UNIQUE (rollout_id, instance_key)
);

CREATE INDEX idx_actor_release_rollouts_process
  ON actor_release_rollouts(tenant_id, blueprint_id, created_at DESC);

CREATE INDEX idx_actor_release_rollout_items_status
  ON actor_release_rollout_items(tenant_id, rollout_id, status);
