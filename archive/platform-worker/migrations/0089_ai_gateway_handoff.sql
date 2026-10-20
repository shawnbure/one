CREATE TABLE tenant_ai_gateway_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  gateway_id TEXT NOT NULL DEFAULT 'default',
  enabled INTEGER NOT NULL DEFAULT 0,
  collect_logs INTEGER NOT NULL DEFAULT 0,
  evidence_reference TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tenant_ai_gateway_settings
  (tenant_id, gateway_id, enabled, collect_logs, updated_by)
SELECT id, 'default', 0, 0, 'system-migration' FROM tenants;

INSERT INTO model_catalog
  (model_id, provider, label, input_usd_per_million, output_usd_per_million,
   context_tokens, status, pricing_source, pricing_effective_at)
VALUES
  ('openai/gpt-4.1-mini', 'Cloudflare AI Gateway · OpenAI',
   'Gateway · GPT-4.1 mini', 0.40, 1.60, 1047576, 'active',
   'https://developers.cloudflare.com/ai/models/openai/gpt-4.1-mini/',
   '2026-07-23');

INSERT INTO tenant_model_policies (tenant_id, model_id, enabled, updated_by)
SELECT id, 'openai/gpt-4.1-mini', 0, 'system-migration' FROM tenants;

ALTER TABLE executions ADD COLUMN inference_provider TEXT;
ALTER TABLE executions ADD COLUMN gateway_id TEXT;
ALTER TABLE executions ADD COLUMN gateway_step INTEGER;
ALTER TABLE executions ADD COLUMN gateway_cache_status TEXT;
ALTER TABLE executions ADD COLUMN gateway_log_id TEXT;
