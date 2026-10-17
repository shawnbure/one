ALTER TABLE outbox ADD COLUMN reset INTEGER NOT NULL DEFAULT 0;
CREATE INDEX message_created ON records(json_extract(body,'$.createdAt')) WHERE kind='message';
