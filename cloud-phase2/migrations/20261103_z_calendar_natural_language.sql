-- Pending, short-lived confirmation records for natural-language Calendar create/move actions.
-- A Calendar write is never made until the user confirms the exact details in Telegram.

CREATE TABLE IF NOT EXISTS pending_calendar_actions (
  confirmation_code TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create_event', 'update_event')),
  event_id TEXT,
  expected_title TEXT,
  expected_start TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_calendar_actions_chat_expiry
  ON pending_calendar_actions (chat_id, expires_at, consumed_at);
