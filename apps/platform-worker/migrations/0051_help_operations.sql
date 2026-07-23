CREATE TABLE help_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  created_by TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('how_to','unexpected_result','access','incident','privacy')),
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
  subject TEXT NOT NULL,
  detail TEXT NOT NULL,
  blueprint_id TEXT,
  execution_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  assigned_to TEXT,
  due_at TEXT NOT NULL,
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_help_requests_tenant_status
  ON help_requests(tenant_id, status, priority, due_at);

CREATE INDEX idx_help_requests_requester
  ON help_requests(tenant_id, created_by, created_at DESC);

ALTER TABLE tenant_retention_controls ADD COLUMN help_request_days INTEGER NOT NULL DEFAULT 365
  CHECK (help_request_days BETWEEN 1 AND 2555);

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity, owner_id,
   acknowledgement_required, escalation_minutes)
SELECT 'notify-help-request-' || t.id, t.id, 'help.request.created', 'in_app', NULL, 1, 'warning',
  COALESCE(l.support_owner_id, (
    SELECT m.id FROM tenant_members m WHERE m.tenant_id = t.id AND m.status = 'active'
      AND m.role IN ('admin','owner','operator')
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at LIMIT 1
  )),
  1, 1440
FROM tenants t LEFT JOIN tenant_lifecycle_settings l ON l.tenant_id = t.id;
