ALTER TABLE knowledge_extraction_log
	ADD COLUMN IF NOT EXISTS backfill_oldest_message_id uuid;

CREATE INDEX IF NOT EXISTS knowledge_extraction_log_backfill_cursor_idx
	ON knowledge_extraction_log (workspace_id, backfill_completed_at, backfill_oldest_message_at, backfill_oldest_message_id);
