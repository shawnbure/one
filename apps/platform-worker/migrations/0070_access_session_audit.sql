CREATE TABLE access_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  identity_type TEXT NOT NULL CHECK (identity_type IN ('human','service')),
  client_label TEXT NOT NULL,
  country_code TEXT,
  colo_code TEXT,
  issued_at TEXT,
  expires_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_count INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX access_sessions_tenant_seen
  ON access_sessions(tenant_id, last_seen_at DESC, id);
CREATE INDEX access_sessions_actor_seen
  ON access_sessions(tenant_id, actor_id, last_seen_at DESC);

CREATE TABLE emergency_access_plans (
  tenant_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  procedure_summary TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  review_due_at TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (member_id) REFERENCES tenant_members(id),
  FOREIGN KEY (updated_by) REFERENCES tenant_members(id)
);

CREATE TABLE emergency_access_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  access_session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed')),
  classification TEXT CHECK (classification IN ('drill','incident','false_positive')),
  review_note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, access_session_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (member_id) REFERENCES tenant_members(id),
  FOREIGN KEY (access_session_id) REFERENCES access_sessions(id),
  FOREIGN KEY (reviewed_by) REFERENCES tenant_members(id)
);

CREATE INDEX emergency_access_events_tenant_status
  ON emergency_access_events(tenant_id, status, observed_at DESC);
