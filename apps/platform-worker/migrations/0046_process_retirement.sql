CREATE TABLE process_retirements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  status TEXT NOT NULL CHECK (status IN ('requested','approved','disposing','disposed','cancelled','failed')),
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0,1)),
  legal_hold_reason TEXT,
  delete_execution_payloads INTEGER NOT NULL DEFAULT 1 CHECK (delete_execution_payloads IN (0,1)),
  delete_approval_content INTEGER NOT NULL DEFAULT 1 CHECK (delete_approval_content IN (0,1)),
  delete_prompt_content INTEGER NOT NULL DEFAULT 0 CHECK (delete_prompt_content IN (0,1)),
  approved_by TEXT,
  approved_at TEXT,
  scheduled_for TEXT,
  disposal_job_id TEXT,
  disposed_at TEXT,
  disposed_by TEXT,
  evidence_json TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_process_retirement_open
  ON process_retirements(tenant_id, blueprint_id)
  WHERE status IN ('requested','approved','disposing','failed');

CREATE INDEX idx_process_retirement_due
  ON process_retirements(status, legal_hold, scheduled_for);
