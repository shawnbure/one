ALTER TABLE executions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE executions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE executions ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_executions_tenant_model_started
  ON executions(tenant_id, model, started_at DESC);
