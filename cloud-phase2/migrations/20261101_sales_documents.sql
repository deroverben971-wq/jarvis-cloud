-- Additive Phase 1 schema for JARVIS Sales Intelligence Telegram document intake.
-- Telegram retains the document; D1 stores only the private file reference and metadata.
-- No existing JARVIS tables or rows are modified.

CREATE TABLE IF NOT EXISTS sales_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_size_bytes INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'analysis_pending', 'analyzing', 'analyzed', 'failed', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (chat_id, telegram_file_unique_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_documents_chat_created
  ON sales_documents (chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_documents_chat_status
  ON sales_documents (chat_id, status, id);
