ALTER TABLE executions ADD COLUMN autonomy_level TEXT;
ALTER TABLE executions ADD COLUMN autonomy_disposition TEXT;
ALTER TABLE executions ADD COLUMN approval_id TEXT;

ALTER TABLE approvals ADD COLUMN autonomy_level TEXT;
ALTER TABLE approvals ADD COLUMN action_risk TEXT NOT NULL DEFAULT 'medium';

CREATE INDEX IF NOT EXISTS executions_autonomy_started
  ON executions(tenant_id, autonomy_level, started_at DESC);
CREATE INDEX IF NOT EXISTS approvals_execution_status
  ON approvals(tenant_id, execution_id, status);
