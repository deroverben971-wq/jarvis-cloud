ALTER TABLE usage_daily
ADD COLUMN audio_seconds INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_usage_daily_audio
ON usage_daily(usage_day, audio_seconds);
