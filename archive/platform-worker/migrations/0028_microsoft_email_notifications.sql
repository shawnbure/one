INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity)
SELECT 'notify-approval-email-' || id, id, 'approval.pending', 'email', NULL, 0, 'warning' FROM tenants;

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity)
SELECT 'notify-execution-email-' || id, id, 'execution.failed', 'email', NULL, 0, 'critical' FROM tenants;

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity)
SELECT 'notify-queue-email-' || id, id, 'queue.retry_exhausted', 'email', NULL, 0, 'critical' FROM tenants;
