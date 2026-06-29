-- Knowledge evidence chunks.
-- Adds a first-class ANN retrieval lane for masked evidence windows while
-- keeping confirmed graph facts in knowledge_links and provenance in
-- knowledge_evidence.

CREATE TABLE IF NOT EXISTS knowledge_evidence_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_evidence_id uuid NOT NULL REFERENCES knowledge_evidence(id) ON DELETE CASCADE,
  knowledge_node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  related_knowledge_node_id uuid REFERENCES knowledge_nodes(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  chunk_kind text NOT NULL DEFAULT 'evidence_window',
  masked_text text NOT NULL,
  source_start_offset integer,
  source_end_offset integer,
  participants jsonb,
  embedding halfvec(512),
  embedding_fingerprint text NOT NULL,
  masking_policy_version text NOT NULL DEFAULT 'mask-v1',
  chunking_policy_version text NOT NULL DEFAULT 'evidence-window-v1',
  metadata jsonb,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_evidence_chunks_kind_chk CHECK (
    chunk_kind IN ('evidence_window', 'quote_window', 'message_window', 'manual')
  ),
  CONSTRAINT knowledge_evidence_chunks_offsets_chk CHECK (
    source_start_offset IS NULL
    OR source_end_offset IS NULL
    OR source_end_offset >= source_start_offset
  ),
  CONSTRAINT knowledge_evidence_chunks_masked_text_chk CHECK (length(btrim(masked_text)) > 0),
  CONSTRAINT knowledge_evidence_chunks_fingerprint_chk CHECK (
    length(btrim(embedding_fingerprint)) > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_evidence_chunks_identity_uniq
  ON knowledge_evidence_chunks (
    workspace_id,
    knowledge_evidence_id,
    chunk_kind,
    embedding_fingerprint,
    coalesce(source_start_offset, -1),
    coalesce(source_end_offset, -1)
  );

CREATE INDEX IF NOT EXISTS knowledge_evidence_chunks_workspace_idx
  ON knowledge_evidence_chunks (workspace_id);

CREATE INDEX IF NOT EXISTS knowledge_evidence_chunks_node_idx
  ON knowledge_evidence_chunks (workspace_id, knowledge_node_id);

CREATE INDEX IF NOT EXISTS knowledge_evidence_chunks_evidence_idx
  ON knowledge_evidence_chunks (workspace_id, knowledge_evidence_id);

CREATE INDEX IF NOT EXISTS knowledge_evidence_chunks_message_idx
  ON knowledge_evidence_chunks (workspace_id, message_id);

CREATE INDEX IF NOT EXISTS knowledge_evidence_chunks_fingerprint_idx
  ON knowledge_evidence_chunks (workspace_id, embedding_fingerprint);

CREATE INDEX IF NOT EXISTS knowledge_evidence_chunks_occurred_at_idx
  ON knowledge_evidence_chunks (workspace_id, occurred_at);

CREATE INDEX IF NOT EXISTS knowledge_evidence_chunks_embedding_idx
  ON knowledge_evidence_chunks USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

ALTER TABLE knowledge_evidence_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON knowledge_evidence_chunks;
CREATE POLICY workspace_isolation ON knowledge_evidence_chunks
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
