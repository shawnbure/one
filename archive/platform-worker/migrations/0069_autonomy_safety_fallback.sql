ALTER TABLE agent_blueprints ADD COLUMN fallback_enabled INTEGER NOT NULL DEFAULT 1 CHECK (fallback_enabled IN (0,1));
ALTER TABLE agent_blueprints ADD COLUMN fallback_min_terminal_runs INTEGER NOT NULL DEFAULT 5
  CHECK (fallback_min_terminal_runs BETWEEN 3 AND 100);
ALTER TABLE agent_blueprints ADD COLUMN fallback_success_threshold INTEGER NOT NULL DEFAULT 70
  CHECK (fallback_success_threshold BETWEEN 1 AND 100);
ALTER TABLE agent_blueprints ADD COLUMN fallback_window_hours INTEGER NOT NULL DEFAULT 24
  CHECK (fallback_window_hours BETWEEN 1 AND 168);
ALTER TABLE agent_blueprints ADD COLUMN safety_autonomy_cap TEXT
  CHECK (safety_autonomy_cap IN ('observe','suggest','approve','guarded','autonomous'));
ALTER TABLE agent_blueprints ADD COLUMN safety_cap_reason TEXT;
ALTER TABLE agent_blueprints ADD COLUMN safety_cap_trigger TEXT
  CHECK (safety_cap_trigger IN ('unsafe_shadow','unsafe_evaluation','reliability'));
ALTER TABLE agent_blueprints ADD COLUMN safety_cap_evidence_id TEXT;
ALTER TABLE agent_blueprints ADD COLUMN safety_cap_triggered_at TEXT;
ALTER TABLE agent_blueprints ADD COLUMN safety_cap_cleared_at TEXT;
ALTER TABLE agent_blueprints ADD COLUMN safety_cap_revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS agent_blueprints_active_safety_cap
  ON agent_blueprints(tenant_id, safety_autonomy_cap, safety_cap_triggered_at DESC)
  WHERE safety_autonomy_cap IS NOT NULL;
