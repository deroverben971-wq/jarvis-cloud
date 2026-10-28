-- Run this against your Cloudflare D1 database.
-- Reminder content stays in D1; do not commit real reminder data to GitHub.

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  task TEXT NOT NULL,
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON reminders (sent_at, cancelled_at, due_at);

CREATE INDEX IF NOT EXISTS idx_reminders_chat
  ON reminders (chat_id, due_at);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL
);
 
-- Messages for the local Ollama bridge. Only the configured chat is enqueued.
CREATE TABLE IF NOT EXISTS bridge_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bridge_queue_status_id
  ON bridge_queue (status, id);

-- Cloud-hosted AI chat history and long-term facts.
-- These are separate from the existing local SQLite database on Windows.
CREATE TABLE IF NOT EXISTS cloud_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_messages_chat_id
  ON cloud_messages (chat_id, id);

CREATE TABLE IF NOT EXISTS cloud_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_facts_chat_id
  ON cloud_facts (chat_id, id);

-- Metadata for optional, explicitly requested phone calls. Do not store phone numbers here.
CREATE TABLE IF NOT EXISTS phone_call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  purpose TEXT NOT NULL,
  call_sid TEXT
);

CREATE INDEX IF NOT EXISTS idx_phone_call_log_chat_created
  ON phone_call_log (chat_id, created_at);

CREATE TABLE IF NOT EXISTS phone_call_reminders (
  reminder_id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  call_sid TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_phone_call_reminders_status
  ON phone_call_reminders (status, reminder_id);

-- Short-lived confirmation tokens for safe, user-confirmed Google Calendar deletion.
CREATE TABLE IF NOT EXISTS pending_calendar_deletions (
  confirmation_code TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_title TEXT NOT NULL,
  event_start TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_calendar_deletions_chat_expiry
  ON pending_calendar_deletions (chat_id, expires_at, consumed_at);
