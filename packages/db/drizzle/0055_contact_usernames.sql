-- Persist encrypted Telegram usernames for contacts.
-- Existing rows remain valid; future syncs can backfill username + blind index.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS username_bidx TEXT;

CREATE INDEX IF NOT EXISTS contacts_username_bidx_idx
  ON contacts (username_bidx);
