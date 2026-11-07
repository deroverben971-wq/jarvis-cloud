-- Private PWA pairing codes are one-time and short-lived.
CREATE TABLE IF NOT EXISTS app_pairing_codes (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

-- Store hashes only. The raw device token stays on the user's device.
CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_expiry
  ON app_sessions (expires_at, revoked_at);
