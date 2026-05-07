-- Phase 32: Knowledge Mesh — Node-to-Node Links
-- Directed edges between knowledge nodes representing semantic relationships.
-- Inferred by Nereid's pipeline via co-occurrence and embedding similarity.
-- Idempotent on (workspace_id, source_node_id, target_node_id, link_type).

CREATE TYPE "knowledge_link_type" AS ENUM (
  'part_of',
  'related_to',
  'competes_with',
  'builds_on',
  'funds',
  'uses'
);

CREATE TABLE IF NOT EXISTS "knowledge_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "source_node_id" uuid NOT NULL REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE,
  "target_node_id" uuid NOT NULL REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE,
  "link_type" "knowledge_link_type" NOT NULL,
  -- 0.0–1.0: strength of evidence for the relationship
  "weight" real,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- No duplicate edges: one link per (workspace, source, target, link_type)
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_links_edge_uniq"
  ON "knowledge_links" ("workspace_id", "source_node_id", "target_node_id", "link_type");

-- Efficient outbound traversal from a node
CREATE INDEX IF NOT EXISTS "knowledge_links_source_idx"
  ON "knowledge_links" ("source_node_id", "workspace_id");

-- Efficient inbound traversal to a node
CREATE INDEX IF NOT EXISTS "knowledge_links_target_idx"
  ON "knowledge_links" ("target_node_id", "workspace_id");
