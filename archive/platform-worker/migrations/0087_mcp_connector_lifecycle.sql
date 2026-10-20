ALTER TABLE mcp_connector_tools
  ADD COLUMN available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1));

CREATE INDEX idx_mcp_connector_tools_availability
  ON mcp_connector_tools(tenant_id, connector_id, available, enabled);
