CREATE TABLE rubric_package_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  package_digest TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  publisher_name TEXT NOT NULL,
  publisher_key_id TEXT,
  signature_status TEXT NOT NULL CHECK (signature_status IN ('verified','unsigned')),
  package_json TEXT NOT NULL,
  template_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  UNIQUE (tenant_id, package_digest)
);

CREATE INDEX idx_rubric_package_reviews_tenant_status
  ON rubric_package_reviews(tenant_id, status, submitted_at DESC);
