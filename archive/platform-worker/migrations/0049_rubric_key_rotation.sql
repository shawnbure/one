ALTER TABLE rubric_publisher_trust ADD COLUMN valid_from TEXT;
ALTER TABLE rubric_publisher_trust ADD COLUMN expires_at TEXT;
ALTER TABLE rubric_publisher_trust ADD COLUMN expired_at TEXT;
ALTER TABLE rubric_publisher_trust ADD COLUMN superseded_by_trust_id TEXT;

CREATE TABLE rubric_key_rotations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  publisher_name TEXT NOT NULL,
  predecessor_trust_id TEXT NOT NULL REFERENCES rubric_publisher_trust(id),
  predecessor_key_id TEXT NOT NULL,
  successor_key_id TEXT NOT NULL,
  successor_public_key_x TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  proof TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  overlap_days INTEGER CHECK (overlap_days IS NULL OR overlap_days BETWEEN 0 AND 30),
  successor_trust_id TEXT,
  UNIQUE (tenant_id, successor_key_id)
);

CREATE INDEX idx_rubric_key_rotations_tenant_status
  ON rubric_key_rotations(tenant_id, status, requested_at DESC);

ALTER TABLE rubric_package_reviews ADD COLUMN rotation_id TEXT REFERENCES rubric_key_rotations(id);
