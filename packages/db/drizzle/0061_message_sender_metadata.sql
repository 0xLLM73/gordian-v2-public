ALTER TABLE messages
	ADD COLUMN IF NOT EXISTS telegram_sender_id text,
	ADD COLUMN IF NOT EXISTS telegram_sender_type text;

CREATE INDEX IF NOT EXISTS messages_workspace_sender_idx
	ON messages (workspace_id, telegram_sender_id);
