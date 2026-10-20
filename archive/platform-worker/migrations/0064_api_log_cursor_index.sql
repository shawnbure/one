CREATE INDEX idx_api_logs_tenant_created_id
  ON api_logs(tenant_id, created_at DESC, id DESC);
