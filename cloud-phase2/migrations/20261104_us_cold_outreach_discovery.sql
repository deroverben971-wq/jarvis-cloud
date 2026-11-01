-- US cold-outreach prospect discovery and CAN-SPAM controls.
-- Public role-based contact channels may be used for relevant US commercial outreach
-- only after sender identity, valid postal address, opt-out, suppression and adult review are configured.
-- This migration is additive; run it once.

ALTER TABLE outreach_prospects ADD COLUMN contact_basis TEXT NOT NULL DEFAULT 'unverified'
  CHECK (contact_basis IN ('unverified', 'documented_opt_in', 'public_business_role_inbox', 'not_authorized', 'opted_out'));
ALTER TABLE outreach_prospects ADD COLUMN unsubscribe_token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_outreach_prospects_contact_basis
  ON outreach_prospects (chat_id, contact_basis, guardian_reviewed_at, status);

CREATE TABLE IF NOT EXISTS sales_discovery_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  product_document_id INTEGER NOT NULL,
  region TEXT NOT NULL DEFAULT 'United States',
  max_prospects INTEGER NOT NULL DEFAULT 10 CHECK (max_prospects BETWEEN 1 AND 15),
  queries_json TEXT NOT NULL DEFAULT '[]',
  query_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'searching', 'completed', 'failed')),
  candidates_added INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_document_id) REFERENCES sales_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sales_discovery_jobs_chat
  ON sales_discovery_jobs (chat_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_sales_discovery_jobs_status
  ON sales_discovery_jobs (status, id);
