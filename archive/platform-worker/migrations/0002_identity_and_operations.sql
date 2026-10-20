CREATE TABLE tenant_members (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','builder','owner','operator','reviewer','viewer','consumer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  UNIQUE (tenant_id, email)
);

ALTER TABLE approvals ADD COLUMN title TEXT;
ALTER TABLE approvals ADD COLUMN description TEXT;
ALTER TABLE approvals ADD COLUMN impact TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE approvals ADD COLUMN assigned_to TEXT;
ALTER TABLE approvals ADD COLUMN due_at TEXT;
ALTER TABLE approvals ADD COLUMN decision_note TEXT;

ALTER TABLE executions ADD COLUMN retry_of TEXT;
ALTER TABLE executions ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX approvals_tenant_status_requested ON approvals(tenant_id, status, requested_at DESC);
CREATE INDEX audit_events_tenant_created ON audit_events(tenant_id, created_at DESC);
CREATE INDEX tenant_members_email ON tenant_members(email);

INSERT INTO tenant_members (id, tenant_id, email, display_name, role)
VALUES ('member-demo-admin', 'demo', 'shawnbure@outlook.com', 'Shawn Bure', 'admin');

INSERT INTO executions
  (id, tenant_id, blueprint_id, instance_key, execution_profile, status, input_preview, output_preview, model, started_at, completed_at)
VALUES
  ('demo-exec-approval', 'demo', 'customer-ops', 'customer-ops:thread:northstar-renewal', 'conversation', 'waiting_approval',
   'Prepare Northstar Components renewal summary for account owner.', 'Draft renewal summary prepared and awaiting authorization.',
   '@cf/meta/llama-3.3-70b-instruct-fp8-fast', datetime('now','-18 minutes'), NULL);

INSERT INTO approvals
  (id, tenant_id, execution_id, action_name, action_input_json, status, requested_at, title, description, impact, assigned_to, due_at)
VALUES
  ('demo-approval-renewal', 'demo', 'demo-exec-approval', 'send_renewal_summary',
   '{"customer":"Northstar Components","channel":"account owner email","reversible":true}', 'pending', datetime('now','-14 minutes'),
   'Renewal outreach', 'Send the prepared renewal summary to the Northstar Components account owner.', 'medium',
   'shawnbure@outlook.com', datetime('now','+2 hours'));
