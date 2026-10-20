ALTER TABLE approvals ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE approvals ADD COLUMN proposal_edited_at TEXT;
ALTER TABLE approvals ADD COLUMN proposal_edited_by TEXT;

CREATE INDEX idx_approvals_tenant_revision
  ON approvals(tenant_id, id, revision);
