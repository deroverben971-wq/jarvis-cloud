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
