ALTER TABLE webhook_receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'
  CHECK (status IN ('accepted','enqueue_failed','blocked'));
ALTER TABLE webhook_receipts ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_receipts ADD COLUMN last_error TEXT;
ALTER TABLE webhook_receipts ADD COLUMN updated_at TEXT;

CREATE INDEX idx_webhook_receipts_recovery
  ON webhook_receipts(status, updated_at);
