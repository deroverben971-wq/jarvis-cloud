CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_blocked ON auth_rate_limits(blocked_until_ms);
