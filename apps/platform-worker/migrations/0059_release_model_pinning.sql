ALTER TABLE process_releases ADD COLUMN model_id TEXT;

UPDATE process_releases SET model_id = CASE model_profile
  WHEN 'fast' THEN '@cf/meta/llama-3.1-8b-instruct-fp8'
  WHEN 'balanced' THEN '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  WHEN 'reasoning' THEN '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'
  ELSE NULL
END
WHERE model_id IS NULL;
