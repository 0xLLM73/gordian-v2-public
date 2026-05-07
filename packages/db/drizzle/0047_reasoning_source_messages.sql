-- Sprint 4 Task A: Add reasoning + sourceMessageIds to introductions and connections
-- reasoning: encrypted AI detection reasoning (WHY it detected the intro/connection)
-- sourceMessageIds: array of message UUIDs that triggered detection (not encrypted, just FKs)

DO $$
BEGIN
  CREATE TYPE connection_status AS ENUM ('detected', 'confirmed', 'dismissed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  event text,
  context text,
  confidence real NOT NULL,
  status connection_status NOT NULL DEFAULT 'detected',
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  reasoning text,
  source_message_ids uuid[],
  detected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE introductions ADD COLUMN IF NOT EXISTS reasoning text;
ALTER TABLE introductions ADD COLUMN IF NOT EXISTS source_message_ids uuid[];

ALTER TABLE connections ADD COLUMN IF NOT EXISTS reasoning text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS source_message_ids uuid[];

CREATE INDEX IF NOT EXISTS connections_workspace_contact_idx ON connections (workspace_id, contact_id);
CREATE INDEX IF NOT EXISTS connections_workspace_status_idx ON connections (workspace_id, status);
