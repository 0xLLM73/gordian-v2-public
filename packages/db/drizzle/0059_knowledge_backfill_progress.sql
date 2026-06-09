ALTER TABLE knowledge_extraction_log
	ADD COLUMN IF NOT EXISTS backfill_oldest_message_at timestamptz,
	ADD COLUMN IF NOT EXISTS backfill_messages_scanned integer NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS backfill_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS knowledge_extraction_log_backfill_idx
	ON knowledge_extraction_log (workspace_id, backfill_completed_at, backfill_oldest_message_at);
