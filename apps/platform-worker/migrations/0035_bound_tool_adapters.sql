ALTER TABLE tool_definitions ADD COLUMN handler_key TEXT;

CREATE INDEX tool_definitions_handler
  ON tool_definitions(tenant_id, handler_key, enabled);

INSERT OR IGNORE INTO tool_definitions
  (id, tenant_id, name, description, adapter_kind, connection_id, handler_key, access_mode,
   risk_level, input_schema_json, output_schema_json, data_classification, owner,
   rate_limit_per_minute, support_instructions, created_by)
SELECT
  'tool-ms-profile-' || t.id,
  t.id,
  'get_my_microsoft_profile',
  'Read the connected Microsoft 365 account profile.',
  'microsoft',
  c.id,
  'microsoft.profile.get',
  'read',
  'low',
  '{"type":"object","additionalProperties":false}',
  '{"type":"object","properties":{"displayName":{"type":"string"},"mail":{"type":"string"}}}',
  'internal',
  'Platform Administration',
  30,
  'Requires the delegated User.Read scope. Returns bounded profile metadata.',
  'migration'
FROM tenants t
JOIN connections c ON c.tenant_id=t.id AND c.name='Microsoft 365';

