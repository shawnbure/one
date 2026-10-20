CREATE TABLE tenant_operating_controls (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  mode TEXT NOT NULL DEFAULT 'active' CHECK (mode IN ('active','drain','emergency_stop')),
  incident_id TEXT,
  reason TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE incidents ADD COLUMN blueprint_id TEXT REFERENCES agent_blueprints(id);
ALTER TABLE incidents ADD COLUMN owner_id TEXT;
ALTER TABLE incidents ADD COLUMN category TEXT NOT NULL DEFAULT 'operations';
ALTER TABLE incidents ADD COLUMN impact TEXT NOT NULL DEFAULT '';
ALTER TABLE incidents ADD COLUMN containment_mode TEXT;
ALTER TABLE incidents ADD COLUMN detected_at TEXT;
ALTER TABLE incidents ADD COLUMN acknowledged_at TEXT;
ALTER TABLE incidents ADD COLUMN contained_at TEXT;
ALTER TABLE incidents ADD COLUMN recovery_at TEXT;
ALTER TABLE incidents ADD COLUMN closed_by TEXT;
ALTER TABLE incidents ADD COLUMN root_cause TEXT;
ALTER TABLE incidents ADD COLUMN resolution TEXT;
ALTER TABLE incidents ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE incident_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  detail TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_incidents_tenant_status ON incidents(tenant_id, status, opened_at DESC);
CREATE INDEX idx_incident_events_timeline ON incident_events(tenant_id, incident_id, created_at);

INSERT INTO tenant_operating_controls (tenant_id, mode, updated_by)
SELECT id, 'active', 'system' FROM tenants;

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity)
SELECT 'notify-incident-' || id, id, 'incident.emergency_stop', 'in_app', NULL, 1, 'critical'
FROM tenants;
