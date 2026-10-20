CREATE TABLE execution_knowledge_citations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  score REAL NOT NULL,
  provenance TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (execution_id, ordinal)
);

CREATE INDEX idx_execution_knowledge_citations_tenant_execution
  ON execution_knowledge_citations (tenant_id, execution_id, ordinal);
