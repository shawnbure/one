CREATE TABLE approval_delegations (
  tenant_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  delegate_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, member_id),
  FOREIGN KEY (member_id) REFERENCES tenant_members(id),
  FOREIGN KEY (delegate_id) REFERENCES tenant_members(id)
);

CREATE INDEX idx_approval_delegations_active
  ON approval_delegations(tenant_id, enabled, starts_at, ends_at);

ALTER TABLE approvals ADD COLUMN assigned_via_delegation_from TEXT;
