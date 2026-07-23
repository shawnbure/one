ALTER TABLE inbound_email_routes ADD COLUMN cloudflare_rule_id TEXT;
ALTER TABLE inbound_email_routes ADD COLUMN routing_verified_at TEXT;
ALTER TABLE inbound_email_routes ADD COLUMN routing_verified_by TEXT;
ALTER TABLE inbound_email_routes ADD COLUMN routing_evidence_reference TEXT;
ALTER TABLE inbound_email_routes ADD COLUMN routing_revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_inbound_email_routes_routing_evidence
  ON inbound_email_routes(tenant_id, routing_verified_at);
