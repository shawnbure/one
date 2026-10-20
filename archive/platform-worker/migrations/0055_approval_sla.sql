ALTER TABLE approvals ADD COLUMN sla_escalated_at TEXT;
ALTER TABLE approvals ADD COLUMN sla_escalation_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_approvals_pending_due_escalation
  ON approvals(tenant_id, status, due_at, sla_escalated_at);

UPDATE approvals
SET due_at = datetime(requested_at, '+4 hours')
WHERE status = 'pending' AND due_at IS NULL;

UPDATE approvals
SET assigned_to = (
  SELECT m.email
  FROM tenant_members m
  LEFT JOIN tenant_lifecycle_settings l ON l.tenant_id=m.tenant_id
  WHERE m.tenant_id=approvals.tenant_id AND m.status='active'
    AND m.role IN ('admin','owner','operator','reviewer')
  ORDER BY CASE WHEN m.id=l.support_owner_id THEN 0 WHEN m.role='owner' THEN 1
    WHEN m.role='admin' THEN 2 WHEN m.role='operator' THEN 3 ELSE 4 END, m.id
  LIMIT 1
)
WHERE status='pending' AND assigned_to IS NULL;
