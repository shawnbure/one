ALTER TABLE executions ADD COLUMN cancellation_reason TEXT;
ALTER TABLE executions ADD COLUMN cancelled_at TEXT;
ALTER TABLE executions ADD COLUMN cancelled_by TEXT;

ALTER TABLE process_queue_jobs ADD COLUMN cancellation_requested_at TEXT;
ALTER TABLE process_queue_jobs ADD COLUMN cancellation_requested_by TEXT;
ALTER TABLE process_queue_jobs ADD COLUMN cancellation_reason TEXT;
ALTER TABLE process_queue_jobs ADD COLUMN completion_disposition TEXT
  CHECK (completion_disposition IS NULL OR completion_disposition = 'cancelled');

CREATE INDEX idx_executions_tenant_cancellation
  ON executions(tenant_id, cancelled_at DESC)
  WHERE status = 'cancelled';
