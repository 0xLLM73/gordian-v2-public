-- Knowledge evidence/provenance for topic/contact and topic/topic claims.
-- Stores encrypted message snippets plus structured source metadata.

DO $$
BEGIN
  CREATE TYPE knowledge_evidence_kind AS ENUM (
    'llm_extracted',
    'embedding_match',
    'contact_cooccurrence',
    'manual',
    'inferred_weak'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS knowledge_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  related_knowledge_node_id uuid REFERENCES knowledge_nodes(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  relation_type text NOT NULL,
  evidence_kind knowledge_evidence_kind NOT NULL,
  confidence real,
  snippet text,
  occurred_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_evidence_workspace_idx
  ON knowledge_evidence (workspace_id);

CREATE INDEX IF NOT EXISTS knowledge_evidence_node_idx
  ON knowledge_evidence (workspace_id, knowledge_node_id);

CREATE INDEX IF NOT EXISTS knowledge_evidence_contact_idx
  ON knowledge_evidence (workspace_id, contact_id);

CREATE INDEX IF NOT EXISTS knowledge_evidence_message_idx
  ON knowledge_evidence (workspace_id, message_id);

CREATE INDEX IF NOT EXISTS knowledge_evidence_occurred_at_idx
  ON knowledge_evidence (workspace_id, occurred_at);

CREATE INDEX IF NOT EXISTS knowledge_evidence_related_node_idx
  ON knowledge_evidence (workspace_id, related_knowledge_node_id);

-- The Drizzle schema and DAL expect this extraction cursor table, but older
-- migrations never created it. Keep creation idempotent so existing databases
-- with the table keep their data and fresh databases can run this migration.
CREATE TABLE IF NOT EXISTS knowledge_extraction_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  last_extracted_at timestamptz NOT NULL DEFAULT now(),
  message_horizon timestamptz,
  entities_extracted integer NOT NULL DEFAULT 0,
  llm_called integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_extraction_log_ws_contact_uniq
  ON knowledge_extraction_log (workspace_id, contact_id);

-- RLS coverage for the new evidence table and the adjacent knowledge tables
-- that store workspace-scoped relationship metadata.
ALTER TABLE knowledge_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON knowledge_evidence;
CREATE POLICY workspace_isolation ON knowledge_evidence
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE knowledge_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON knowledge_contacts;
CREATE POLICY workspace_isolation ON knowledge_contacts
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE knowledge_extraction_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON knowledge_extraction_log;
CREATE POLICY workspace_isolation ON knowledge_extraction_log
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
