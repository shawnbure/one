ALTER TABLE knowledge_sources ADD COLUMN object_key TEXT;
ALTER TABLE knowledge_sources ADD COLUMN mime_type TEXT;
ALTER TABLE knowledge_sources ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_sources ADD COLUMN checksum TEXT;
ALTER TABLE knowledge_sources ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE knowledge_sources ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_sources ADD COLUMN indexed_at TEXT;
ALTER TABLE knowledge_sources ADD COLUMN last_error TEXT;
ALTER TABLE knowledge_sources ADD COLUMN updated_at TEXT;

CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, ordinal)
);

CREATE INDEX idx_knowledge_chunks_tenant_source
  ON knowledge_chunks (tenant_id, source_id, ordinal);
