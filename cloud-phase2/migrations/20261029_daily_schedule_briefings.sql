-- Run once in Cloudflare D1 Console before deploying the daily schedule briefing feature.
-- This only tracks briefing delivery; it does not modify reminders or calendar events.
CREATE TABLE IF NOT EXISTS daily_schedule_briefings (
  chat_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempted_at TEXT NOT NULL,
  sent_at TEXT,
  last_error TEXT,
  PRIMARY KEY (chat_id, local_date)
);
