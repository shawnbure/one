CREATE TABLE process_solution_pack_provenance (
  blueprint_id TEXT PRIMARY KEY REFERENCES agent_blueprints(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  pack_id TEXT NOT NULL CHECK (length(pack_id) BETWEEN 3 AND 80),
  pack_version TEXT NOT NULL CHECK (
    pack_version NOT GLOB '*[^0-9.]*'
    AND pack_version NOT LIKE '.%'
    AND pack_version NOT LIKE '%.'
    AND length(pack_version) - length(replace(pack_version, '.', '')) = 2
    AND length(pack_version) BETWEEN 5 AND 32
  ),
  installed_by TEXT NOT NULL REFERENCES tenant_members(id),
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, blueprint_id)
);

CREATE INDEX idx_solution_pack_provenance_tenant_pack
  ON process_solution_pack_provenance (tenant_id, pack_id, installed_at DESC);
