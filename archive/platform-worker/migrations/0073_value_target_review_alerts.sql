CREATE UNIQUE INDEX notification_value_target_review_once
  ON notification_events(tenant_id, policy_id, target_id)
  WHERE event_type = 'value.target_review_due';

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity, owner_id,
   acknowledgement_required, escalation_minutes)
SELECT 'notify-value-target-review-' || t.id, t.id, 'value.target_review_due',
  'in_app', NULL, 1, 'warning',
  COALESCE(l.support_owner_id, (
    SELECT m.id FROM tenant_members m
    WHERE m.tenant_id=t.id AND m.status='active' AND m.role IN ('owner','admin','operator')
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at
    LIMIT 1
  )),
  1, 1440
FROM tenants t
LEFT JOIN tenant_lifecycle_settings l ON l.tenant_id=t.id;

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity,
   acknowledgement_required, escalation_minutes)
SELECT 'notify-value-target-review-email-' || id, id, 'value.target_review_due',
  'email', NULL, 0, 'warning', 0, 0
FROM tenants;

INSERT OR IGNORE INTO notification_policies
  (id, tenant_id, event_type, channel, destination, enabled, severity,
   acknowledgement_required, escalation_minutes, credential_ref_id)
SELECT 'notify-value-target-review-webhook-' || id, id, 'value.target_review_due',
  'webhook', NULL, 0, 'warning', 0, 0,
  (SELECT r.id FROM integration_credential_refs r
   WHERE r.tenant_id=tenants.id AND r.secret_binding='NOTIFICATION_WEBHOOK_SECRET'
   LIMIT 1)
FROM tenants;
