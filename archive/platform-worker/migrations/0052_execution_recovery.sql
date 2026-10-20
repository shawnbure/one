CREATE TABLE execution_recovery_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  assigned_to TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'resolved', 'accepted_risk')),
  due_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  resolution TEXT,
  resolution_execution_id TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, execution_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (execution_id) REFERENCES executions(id),
  FOREIGN KEY (assigned_to) REFERENCES tenant_members(id),
  FOREIGN KEY (resolution_execution_id) REFERENCES executions(id),
  FOREIGN KEY (resolved_by) REFERENCES tenant_members(id)
);

CREATE INDEX idx_execution_recovery_tenant_status_due
  ON execution_recovery_tasks(tenant_id, status, due_at);
CREATE INDEX idx_execution_recovery_assignee
  ON execution_recovery_tasks(tenant_id, assigned_to, status);

CREATE TRIGGER execution_recovery_after_insert
AFTER INSERT ON executions
WHEN NEW.status IN ('failed', 'blocked', 'deferred')
BEGIN
  INSERT OR IGNORE INTO execution_recovery_tasks
    (id, tenant_id, execution_id, assigned_to, due_at)
  VALUES (
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
      substr(hex(randomblob(2)), 2) || '-' ||
      substr('89ab', abs(random()) % 4 + 1, 1) ||
      substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
    NEW.tenant_id,
    NEW.id,
    (SELECT recovery_owner_id FROM tenant_lifecycle_settings WHERE tenant_id=NEW.tenant_id),
    datetime(CURRENT_TIMESTAMP, CASE WHEN NEW.status='deferred' THEN '+1 day' ELSE '+4 hours' END)
  );
END;

CREATE TRIGGER execution_recovery_after_status_update
AFTER UPDATE OF status ON executions
WHEN NEW.status IN ('failed', 'blocked', 'deferred') AND OLD.status <> NEW.status
BEGIN
  INSERT OR IGNORE INTO execution_recovery_tasks
    (id, tenant_id, execution_id, assigned_to, due_at)
  VALUES (
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
      substr(hex(randomblob(2)), 2) || '-' ||
      substr('89ab', abs(random()) % 4 + 1, 1) ||
      substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
    NEW.tenant_id,
    NEW.id,
    (SELECT recovery_owner_id FROM tenant_lifecycle_settings WHERE tenant_id=NEW.tenant_id),
    datetime(CURRENT_TIMESTAMP, CASE WHEN NEW.status='deferred' THEN '+1 day' ELSE '+4 hours' END)
  );
END;

INSERT OR IGNORE INTO execution_recovery_tasks
  (id, tenant_id, execution_id, assigned_to, due_at, created_at, updated_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  e.tenant_id,
  e.id,
  l.recovery_owner_id,
  datetime(COALESCE(e.completed_at, e.started_at, CURRENT_TIMESTAMP),
    CASE WHEN e.status='deferred' THEN '+1 day' ELSE '+4 hours' END),
  COALESCE(e.completed_at, e.started_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM executions e
LEFT JOIN tenant_lifecycle_settings l ON l.tenant_id=e.tenant_id
WHERE e.status IN ('failed', 'blocked', 'deferred');
