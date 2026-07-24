ALTER TABLE process_solution_pack_handoff_checks
  ADD COLUMN gate_type TEXT NOT NULL DEFAULT 'handoff'
  CHECK (gate_type IN ('publication', 'handoff'));

