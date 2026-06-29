-- Knowledge relationship candidates.
-- Heuristic relationship signals are review-only until direct quoted evidence
-- promotes them into knowledge_links.

ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'affiliated_with';
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'alternative_to';
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'works_on';
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'owns_or_responsible_for';
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'interested_in';
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'requested';
ALTER TYPE knowledge_link_type ADD VALUE IF NOT EXISTS 'depends_on';

CREATE TABLE IF NOT EXISTS knowledge_relationship_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  target_node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  link_type knowledge_link_type NOT NULL,
  evidence_kind knowledge_evidence_kind NOT NULL,
  confidence real,
  promotion_status text NOT NULL DEFAULT 'review_only',
  promotion_reason text,
  source_evidence_id uuid REFERENCES knowledge_evidence(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  promoted_link_id uuid REFERENCES knowledge_links(id) ON DELETE SET NULL,
  promoted_at timestamptz,
  metadata jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_relationship_candidates_status_chk CHECK (
    promotion_status IN ('review_only', 'eligible', 'promoted', 'rejected')
  ),
  CONSTRAINT knowledge_relationship_candidates_no_self_edge_chk CHECK (
    source_node_id <> target_node_id
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_rel_candidates_edge_kind_uniq
  ON knowledge_relationship_candidates (
    workspace_id,
    source_node_id,
    target_node_id,
    link_type,
    evidence_kind
  );

CREATE INDEX IF NOT EXISTS knowledge_rel_candidates_workspace_status_idx
  ON knowledge_relationship_candidates (workspace_id, promotion_status);

CREATE INDEX IF NOT EXISTS knowledge_rel_candidates_source_idx
  ON knowledge_relationship_candidates (workspace_id, source_node_id);

CREATE INDEX IF NOT EXISTS knowledge_rel_candidates_target_idx
  ON knowledge_relationship_candidates (workspace_id, target_node_id);

CREATE INDEX IF NOT EXISTS knowledge_rel_candidates_message_idx
  ON knowledge_relationship_candidates (workspace_id, message_id);

CREATE INDEX IF NOT EXISTS knowledge_rel_candidates_evidence_idx
  ON knowledge_relationship_candidates (workspace_id, source_evidence_id);

ALTER TABLE knowledge_relationship_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON knowledge_relationship_candidates;
CREATE POLICY workspace_isolation ON knowledge_relationship_candidates
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
