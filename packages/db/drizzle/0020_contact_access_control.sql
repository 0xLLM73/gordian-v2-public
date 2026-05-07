-- Phase 28: Contact Access Control
-- Adds source_account_id to contacts and creates contact_shares table

-- 1. Add source_account_id to contacts (nullable, no default — existing rows get NULL)
ALTER TABLE contacts ADD COLUMN source_account_id TEXT;
CREATE INDEX idx_contacts_source_account ON contacts (workspace_id, source_account_id);

-- 2. Create contact_shares table
CREATE TABLE contact_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX contact_shares_uniq ON contact_shares (workspace_id, contact_id, shared_with_user_id);
CREATE INDEX contact_shares_workspace_idx ON contact_shares (workspace_id);
CREATE INDEX contact_shares_shared_with_idx ON contact_shares (shared_with_user_id);
CREATE INDEX contact_shares_contact_idx ON contact_shares (contact_id);
