ALTER TABLE shadow_trades ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE shadow_trades ADD COLUMN IF NOT EXISTS last_retry_at bigint;