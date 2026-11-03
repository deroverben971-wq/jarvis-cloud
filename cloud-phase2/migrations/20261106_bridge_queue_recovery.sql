-- Track when a local bridge job is claimed. Stale processing jobs are marked
-- outcome-unknown rather than blindly replayed, preventing duplicate actions.
ALTER TABLE bridge_queue ADD COLUMN claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bridge_queue_status_claimed
  ON bridge_queue (status, claimed_at);
