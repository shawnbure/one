ALTER TABLE executions ADD COLUMN estimated_cost_usd REAL NOT NULL DEFAULT 0;

CREATE TABLE model_catalog (
  model_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  input_usd_per_million REAL NOT NULL,
  output_usd_per_million REAL NOT NULL,
  context_tokens INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  pricing_source TEXT NOT NULL,
  pricing_effective_at TEXT NOT NULL
);

CREATE TABLE tenant_budgets (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  monthly_limit_usd REAL NOT NULL DEFAULT 25,
  warning_percent INTEGER NOT NULL DEFAULT 80,
  hard_limit INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

INSERT INTO model_catalog
  (model_id, provider, label, input_usd_per_million, output_usd_per_million, context_tokens, pricing_source, pricing_effective_at)
VALUES
  ('@cf/meta/llama-3.1-8b-instruct-fp8', 'Cloudflare Workers AI', 'Fast · Llama 3.1 8B FP8', 0.152, 0.287, 32000, 'https://developers.cloudflare.com/workers-ai/platform/pricing/', '2026-07-08'),
  ('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Cloudflare Workers AI', 'Balanced · Llama 3.3 70B FP8', 0.293, 2.253, 24000, 'https://developers.cloudflare.com/workers-ai/platform/pricing/', '2026-07-08'),
  ('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', 'Cloudflare Workers AI', 'Reasoning · DeepSeek R1 32B', 0.497, 4.881, 80000, 'https://developers.cloudflare.com/workers-ai/platform/pricing/', '2026-07-08');

INSERT INTO tenant_budgets (tenant_id, monthly_limit_usd, warning_percent, hard_limit, updated_by)
VALUES ('demo', 25, 80, 0, 'system');
