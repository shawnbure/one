INSERT OR REPLACE INTO model_catalog
  (model_id, provider, label, input_usd_per_million, output_usd_per_million,
   context_tokens, pricing_source, pricing_effective_at)
VALUES
  ('@cf/qwen/qwen3-30b-a3b-fp8', 'Cloudflare Workers AI',
   'Reasoning · Qwen3 30B A3B FP8', 0.051, 0.34, 32768,
   'https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/',
   '2026-07-23');
