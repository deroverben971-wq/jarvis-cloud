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

-- One short-lived natural-language clarification draft per authorized Telegram chat.
-- Users can answer missing date/time details in the next message or cancel the draft.

CREATE TABLE IF NOT EXISTS calendar_intent_drafts (
  chat_id TEXT PRIMARY KEY,
  intent_kind TEXT NOT NULL CHECK (intent_kind IN ('create', 'move')),
  original_text TEXT NOT NULL,
  missing_detail TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_intent_drafts_expiry
  ON calendar_intent_drafts (expires_at);
