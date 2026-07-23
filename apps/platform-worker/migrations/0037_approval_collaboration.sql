ALTER TABLE approvals ADD COLUMN review_state TEXT NOT NULL DEFAULT 'decision_pending'
  CHECK (review_state IN ('decision_pending','information_requested','escalated'));
ALTER TABLE approvals ADD COLUMN escalation_level INTEGER NOT NULL DEFAULT 0
  CHECK (escalation_level BETWEEN 0 AND 3);
ALTER TABLE approvals ADD COLUMN last_activity_at TEXT;

UPDATE approvals SET last_activity_at=COALESCE(decided_at, requested_at);

CREATE TABLE approval_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  approval_id TEXT NOT NULL REFERENCES approvals(id),
  author_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment','information_request','information_response','escalation')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX approval_messages_timeline
  ON approval_messages(tenant_id, approval_id, created_at);
