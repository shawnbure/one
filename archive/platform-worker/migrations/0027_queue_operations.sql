CREATE TABLE process_queue_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  execution_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('api','webhook','schedule','replay')),
  status TEXT NOT NULL CHECK (status IN (
    'queued','processing','retrying','completed','deferred','dead_lettered','enqueue_failed'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  replayed_from TEXT,
  last_error TEXT,
  enqueued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, execution_id)
);

CREATE INDEX idx_process_queue_jobs_tenant_status
  ON process_queue_jobs(tenant_id, status, updated_at DESC);

CREATE INDEX idx_process_queue_jobs_execution
  ON process_queue_jobs(tenant_id, execution_id);

CREATE UNIQUE INDEX idx_process_queue_jobs_one_replay
  ON process_queue_jobs(tenant_id, replayed_from)
  WHERE replayed_from IS NOT NULL;
