-- Additive Sales Intelligence business-research and permission controls.
-- Publicly listed role inboxes are research evidence, not permission to market.
-- Outbound sends and scheduled follow-ups require documented opt-in and guardian review.

ALTER TABLE outreach_campaigns ADD COLUMN guardian_approved_at TEXT;
ALTER TABLE outreach_campaigns ADD COLUMN guardian_approved_by TEXT;
ALTER TABLE outreach_campaigns ADD COLUMN auto_send_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_send_enabled IN (0,1));

ALTER TABLE outreach_prospects ADD COLUMN contact_permission_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (contact_permission_status IN ('unverified', 'documented_opt_in', 'not_authorized', 'opted_out'));
ALTER TABLE outreach_prospects ADD COLUMN permission_source TEXT;
ALTER TABLE outreach_prospects ADD COLUMN permission_verified_at TEXT;
ALTER TABLE outreach_prospects ADD COLUMN guardian_reviewed_at TEXT;
ALTER TABLE outreach_prospects ADD COLUMN guardian_reviewed_by TEXT;
ALTER TABLE outreach_prospects ADD COLUMN contact_source_url TEXT;

CREATE INDEX IF NOT EXISTS idx_outreach_prospects_permission
  ON outreach_prospects (chat_id, contact_permission_status, guardian_reviewed_at, status);

CREATE TABLE IF NOT EXISTS sales_research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  website_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'researching', 'completed', 'failed')),
  profile_json TEXT,
  public_emails_json TEXT NOT NULL DEFAULT '[]',
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_research_chat_created
  ON sales_research (chat_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_sales_research_status
  ON sales_research (status, id);


CREATE TABLE IF NOT EXISTS sales_scripts (
  product_document_id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  script_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_document_id) REFERENCES sales_documents(id) ON DELETE CASCADE
);
