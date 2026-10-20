CREATE TABLE tool_definitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  adapter_kind TEXT NOT NULL DEFAULT 'mock'
    CHECK (adapter_kind IN ('mock','http','microsoft','database','import_export')),
  connection_id TEXT REFERENCES connections(id),
  access_mode TEXT NOT NULL DEFAULT 'read' CHECK (access_mode IN ('read','write')),
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  input_schema_json TEXT NOT NULL DEFAULT '{"type":"object","additionalProperties":true}',
  output_schema_json TEXT NOT NULL DEFAULT '{"type":"object","additionalProperties":true}',
  data_classification TEXT NOT NULL DEFAULT 'internal'
    CHECK (data_classification IN ('public','internal','confidential','restricted')),
  owner TEXT NOT NULL DEFAULT 'Operations',
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute BETWEEN 1 AND 10000),
  support_instructions TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);

CREATE TABLE process_tool_bindings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  tool_id TEXT NOT NULL REFERENCES tool_definitions(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, blueprint_id, tool_id)
);

CREATE INDEX tool_definitions_connection
  ON tool_definitions(tenant_id, connection_id, enabled);
CREATE INDEX process_tool_bindings_process
  ON process_tool_bindings(tenant_id, blueprint_id, enabled);

ALTER TABLE process_releases ADD COLUMN tool_policy_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE executions ADD COLUMN tool_policy_json TEXT NOT NULL DEFAULT '[]';

INSERT OR IGNORE INTO tool_definitions
  (id, tenant_id, name, description, adapter_kind, access_mode, risk_level, owner, created_by)
SELECT
  'tool-' || lower(hex(randomblob(12))),
  b.tenant_id,
  CAST(j.value AS TEXT),
  'Template capability for ' || replace(CAST(j.value AS TEXT), '_', ' '),
  'mock',
  CASE
    WHEN CAST(j.value AS TEXT) LIKE 'create_%'
      OR CAST(j.value AS TEXT) LIKE 'update_%'
      OR CAST(j.value AS TEXT) LIKE 'send_%' THEN 'write'
    ELSE 'read'
  END,
  CASE
    WHEN CAST(j.value AS TEXT) LIKE 'create_%'
      OR CAST(j.value AS TEXT) LIKE 'update_%'
      OR CAST(j.value AS TEXT) LIKE 'send_%' THEN 'medium'
    ELSE 'low'
  END,
  COALESCE(NULLIF(b.business_owner, ''), 'Operations'),
  'migration'
FROM agent_blueprints b, json_each(b.tools_json) j;

INSERT OR IGNORE INTO process_tool_bindings
  (tenant_id, blueprint_id, tool_id, enabled, created_by)
SELECT b.tenant_id, b.id, t.id, 1, 'migration'
FROM agent_blueprints b, json_each(b.tools_json) j
JOIN tool_definitions t
  ON t.tenant_id = b.tenant_id AND t.name = CAST(j.value AS TEXT);

UPDATE process_releases
SET tool_policy_json = COALESCE((
  SELECT json_group_array(json_object(
    'id', t.id,
    'name', t.name,
    'version', t.version,
    'adapterKind', t.adapter_kind,
    'accessMode', t.access_mode,
    'riskLevel', t.risk_level,
    'connectionId', t.connection_id,
    'connectionReady', CASE
      WHEN t.connection_id IS NULL AND t.adapter_kind = 'mock' THEN 1
      WHEN c.status = 'healthy' AND c.secret_configured = 1 THEN 1
      ELSE 0
    END,
    'dataClassification', t.data_classification,
    'rateLimitPerMinute', t.rate_limit_per_minute,
    'inputSchemaJson', t.input_schema_json,
    'outputSchemaJson', t.output_schema_json
    ,'description', t.description
    ,'owner', t.owner
    ,'supportInstructions', t.support_instructions
  ))
  FROM process_tool_bindings pt
  JOIN tool_definitions t ON t.id = pt.tool_id AND t.tenant_id = pt.tenant_id
  LEFT JOIN connections c ON c.id = t.connection_id AND c.tenant_id = t.tenant_id
  WHERE pt.tenant_id = process_releases.tenant_id
    AND pt.blueprint_id = process_releases.blueprint_id
    AND pt.enabled = 1 AND t.enabled = 1
), '[]');
