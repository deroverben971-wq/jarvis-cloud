-- One row can represent a repeating reminder; the Cron Trigger advances due_at
-- after each successful delivery. Existing one-time reminders default to 'none'.
ALTER TABLE reminders
  ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'
  CHECK (recurrence IN ('none', 'daily', 'weekly'));

ALTER TABLE reminders
  ADD COLUMN recurrence_end_at TEXT;

CREATE INDEX IF NOT EXISTS idx_reminders_recurring_due
  ON reminders (recurrence, due_at, sent_at, cancelled_at);
