-- GC1: deal_candidates table for detected deal opportunities
-- Unblocks GC2-GC5 (detection worker, confirmation UI, pipeline feed, dedup)

CREATE TABLE deal_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_message_id UUID NOT NULL,
  chat_id UUID NOT NULL,
  confidence REAL NOT NULL,
  contact_id UUID REFERENCES contacts(id),
  deal_title_guess TEXT NOT NULL,  -- encrypted at app layer via encryptedText
  deal_type_guess TEXT NOT NULL,
  signals JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  dismissed_at TIMESTAMPTZ,
  confirmed_deal_id UUID REFERENCES deals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dc_workspace_idx ON deal_candidates(workspace_id);
CREATE INDEX dc_workspace_status_idx ON deal_candidates(workspace_id, status);
CREATE INDEX dc_contact_idx ON deal_candidates(contact_id);
