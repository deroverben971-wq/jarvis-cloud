-- Presence heartbeat for the single authorized Windows Ollama bridge.
-- The Worker uses Ollama as the primary brain while this heartbeat is fresh,
-- and falls back to Workers AI while the local PC/bridge is offline.
CREATE TABLE IF NOT EXISTS local_bridge_presence (
  chat_id TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_local_bridge_presence_seen
  ON local_bridge_presence (last_seen_at);
