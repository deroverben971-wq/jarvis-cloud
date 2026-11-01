-- Additive Phase 2 storage for extracted product text and analysis.
-- Requires 20261101_sales_documents.sql to have been applied first.
-- No existing JARVIS records are changed or deleted.

CREATE TABLE IF NOT EXISTS sales_document_analysis (
  document_id INTEGER PRIMARY KEY,
  extracted_markdown TEXT,
  extracted_sha256 TEXT,
  product_profile_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  analyzed_at TEXT,
  FOREIGN KEY (document_id) REFERENCES sales_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sales_document_analysis_attempts
  ON sales_document_analysis (attempts, document_id);
