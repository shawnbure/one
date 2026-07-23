ALTER TABLE agent_blueprints ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'internal'
  CHECK (data_classification IN ('public','internal','confidential','restricted'));

ALTER TABLE process_releases ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'internal'
  CHECK (data_classification IN ('public','internal','confidential','restricted'));

CREATE TABLE tenant_data_egress_policies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  classification TEXT NOT NULL CHECK (classification IN ('public','internal','confidential','restricted')),
  external_model_allowed INTEGER NOT NULL DEFAULT 0,
  external_tool_allowed INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, classification)
);

INSERT INTO tenant_data_egress_policies
  (tenant_id, classification, external_model_allowed, external_tool_allowed, updated_by)
SELECT id, 'public', 1, 1, 'system' FROM tenants;
INSERT INTO tenant_data_egress_policies
  (tenant_id, classification, external_model_allowed, external_tool_allowed, updated_by)
SELECT id, 'internal', 0, 1, 'system' FROM tenants;
INSERT INTO tenant_data_egress_policies
  (tenant_id, classification, external_model_allowed, external_tool_allowed, updated_by)
SELECT id, 'confidential', 0, 0, 'system' FROM tenants;
INSERT INTO tenant_data_egress_policies
  (tenant_id, classification, external_model_allowed, external_tool_allowed, updated_by)
SELECT id, 'restricted', 0, 0, 'system' FROM tenants;

