CREATE TABLE platform_maintenance_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'healthy', 'degraded')),
  task_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  task_results_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_platform_maintenance_runs_started
  ON platform_maintenance_runs(started_at DESC);
