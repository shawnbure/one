CREATE TABLE tenant_lifecycle_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  support_owner_id TEXT,
  recovery_owner_id TEXT,
  escalation_email TEXT NOT NULL,
  maintenance_day_utc INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_day_utc BETWEEN 0 AND 6),
  maintenance_hour_utc INTEGER NOT NULL DEFAULT 8 CHECK (maintenance_hour_utc BETWEEN 0 AND 23),
  recovery_review_due_at TEXT,
  last_recovery_review_at TEXT,
  support_notes TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tenant_lifecycle_settings
  (tenant_id, support_owner_id, recovery_owner_id, escalation_email, recovery_review_due_at, updated_by)
SELECT s.tenant_id,
  (SELECT id FROM tenant_members m WHERE m.tenant_id=s.tenant_id AND m.status='active'
    AND m.role IN ('admin','owner','operator') ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END LIMIT 1),
  (SELECT id FROM tenant_members m WHERE m.tenant_id=s.tenant_id AND m.status='active'
    AND m.role IN ('admin','owner','operator') ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END LIMIT 1),
  s.support_email,
  datetime('now', '+90 days'),
  s.initialized_by
FROM tenant_settings s;
