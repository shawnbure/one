ALTER TABLE process_releases ADD COLUMN input_schema_json TEXT;
ALTER TABLE process_releases ADD COLUMN output_schema_json TEXT;

ALTER TABLE executions ADD COLUMN process_release_id TEXT;
ALTER TABLE executions ADD COLUMN input_contract_status TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE executions ADD COLUMN output_contract_status TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE executions ADD COLUMN contract_error TEXT;
