CREATE TABLE mcp_connectors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  server_url TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'streamable-http'
    CHECK (transport IN ('streamable-http','sse','auto')),
  status TEXT NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('disabled','connecting','authenticating','ready','attention')),
  oauth_state_hash TEXT,
  tool_count INTEGER NOT NULL DEFAULT 0,
  last_discovered_at TEXT,
  last_error TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, server_url)
);

CREATE INDEX idx_mcp_connectors_tenant_status
  ON mcp_connectors(tenant_id, status, name);
CREATE UNIQUE INDEX idx_mcp_connectors_oauth_state
  ON mcp_connectors(oauth_state_hash)
  WHERE oauth_state_hash IS NOT NULL;

CREATE TABLE mcp_connector_tools (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  connector_id TEXT NOT NULL REFERENCES mcp_connectors(id),
  server_tool_name TEXT NOT NULL,
  ai_tool_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema_json TEXT NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'read' CHECK (access_mode IN ('read','write')),
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high')),
  data_classification TEXT NOT NULL DEFAULT 'confidential'
    CHECK (data_classification IN ('public','internal','confidential','restricted')),
  owner TEXT NOT NULL DEFAULT 'Operations',
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 30 CHECK (rate_limit_per_minute BETWEEN 1 AND 1000),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, connector_id, server_tool_name)
);

CREATE INDEX idx_mcp_connector_tools_connector
  ON mcp_connector_tools(tenant_id, connector_id, enabled, title);

CREATE TABLE process_mcp_tool_bindings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  blueprint_id TEXT NOT NULL REFERENCES agent_blueprints(id),
  mcp_tool_id TEXT NOT NULL REFERENCES mcp_connector_tools(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, blueprint_id, mcp_tool_id)
);

CREATE INDEX idx_process_mcp_tool_bindings_process
  ON process_mcp_tool_bindings(tenant_id, blueprint_id, enabled);
