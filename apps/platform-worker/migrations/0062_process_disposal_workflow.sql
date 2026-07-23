ALTER TABLE process_retirements ADD COLUMN disposal_cursor TEXT;
ALTER TABLE process_retirements ADD COLUMN processed_actors INTEGER NOT NULL DEFAULT 0;
ALTER TABLE process_retirements ADD COLUMN disposed_turns INTEGER NOT NULL DEFAULT 0;
ALTER TABLE process_retirements ADD COLUMN disposed_prompt_bundles INTEGER NOT NULL DEFAULT 0;
