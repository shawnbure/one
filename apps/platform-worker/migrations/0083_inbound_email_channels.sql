ALTER TABLE process_queue_jobs RENAME TO process_queue_jobs_legacy;

CREATE TABLE process_queue_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  execution_id TEXT NOT NULL,
  blueprint_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('api','webhook','email','schedule','replay')),
  status TEXT NOT NULL CHECK (status IN (
    'queued','processing','retrying','completed','deferred','dead_lettered','enqueue_failed'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  replayed_from TEXT,
  last_error TEXT,
  enqueued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, execution_id)
);

INSERT INTO process_queue_jobs
SELECT * FROM process_queue_jobs_legacy;

DROP TABLE process_queue_jobs_legacy;

CREATE INDEX idx_process_queue_jobs_tenant_status
  ON process_queue_jobs(tenant_id, status, updated_at DESC);
CREATE INDEX idx_process_queue_jobs_execution
  ON process_queue_jobs(tenant_id, execution_id);
CREATE UNIQUE INDEX idx_process_queue_jobs_one_replay
  ON process_queue_jobs(tenant_id, replayed_from)
  WHERE replayed_from IS NOT NULL;

CREATE TABLE inbound_email_routes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL COLLATE NOCASE,
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  allowed_sender_domains_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_received_at TEXT,
  UNIQUE (address)
);

CREATE INDEX idx_inbound_email_routes_tenant
  ON inbound_email_routes(tenant_id, status, name);

CREATE TABLE inbound_email_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  route_id TEXT NOT NULL REFERENCES inbound_email_routes(id),
  sender_hash TEXT NOT NULL,
  message_id_hash TEXT NOT NULL,
  subject_checksum TEXT NOT NULL,
  execution_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('accepted','duplicate','blocked','rejected','enqueue_failed')),
  attachment_count INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (route_id, message_id_hash)
);

CREATE INDEX idx_inbound_email_receipts_route_received
  ON inbound_email_receipts(route_id, received_at DESC);
