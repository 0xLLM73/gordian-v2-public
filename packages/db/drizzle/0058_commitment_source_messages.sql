-- Link commitment extraction outputs to the exact source messages that support them.
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS source_message_ids uuid[];
