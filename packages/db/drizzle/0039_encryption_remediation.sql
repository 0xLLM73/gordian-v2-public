-- Encryption Remediation: Add blind index columns for searchable encrypted fields
-- NOTE: text→transitionalEncryptedText requires NO SQL column type change (both are text).
-- Only blind index additions and the attendees jsonb→text conversion need SQL.

-- knowledge_nodes
ALTER TABLE knowledge_nodes ADD COLUMN IF NOT EXISTS name_blind_index text;
CREATE INDEX IF NOT EXISTS knowledge_nodes_name_bidx_idx ON knowledge_nodes (name_blind_index);

-- deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS title_blind_index text;
CREATE INDEX IF NOT EXISTS deals_title_bidx_idx ON deals (title_blind_index);

-- goals
ALTER TABLE goals ADD COLUMN IF NOT EXISTS title_blind_index text;
CREATE INDEX IF NOT EXISTS goals_title_bidx_idx ON goals (title_blind_index);

-- calendar_connections
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS email_blind_index text;
CREATE INDEX IF NOT EXISTS calendar_connections_email_bidx_idx ON calendar_connections (email_blind_index);

-- workspace_invites
CREATE TABLE IF NOT EXISTS workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  email text,
  email_blind_index text,
  role workspace_role NOT NULL DEFAULT 'member',
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS email_blind_index text;
CREATE INDEX IF NOT EXISTS workspace_invites_email_bidx_idx ON workspace_invites (email_blind_index);

-- calendar_events: change attendees from jsonb to text for encryption
ALTER TABLE calendar_events ALTER COLUMN attendees TYPE text USING attendees::text;

-- SEC-ENC-501: Migrate knowledge_nodes unique constraint from encrypted name to blind index
-- Encrypted values have randomized IVs — every ciphertext is unique, so the old constraint never fires
DROP INDEX IF EXISTS knowledge_nodes_name_workspace_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_bidx_workspace_uniq ON knowledge_nodes (workspace_id, name_blind_index, type);

-- SEC-ENC-506: Drop B-tree index on encrypted connections.event — encrypted values are random,
-- B-tree ordering is meaningless
DROP INDEX IF EXISTS connections_workspace_event_idx;
