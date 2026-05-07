-- Phase 31: Knowledge Mesh — Nodes & Contact Links
-- Named entity extraction results stored as a knowledge graph.
-- knowledge_nodes: deduplicated by (workspace_id, name, type).
-- knowledge_contacts: idempotent join table linking nodes to contacts.
-- HNSW index enables sub-millisecond cosine similarity search at scale.

CREATE TYPE "knowledge_node_type" AS ENUM ('topic', 'project', 'organization', 'technology', 'sector', 'concept');
CREATE TYPE "knowledge_contact_rel_type" AS ENUM ('knows_about', 'works_on', 'member_of', 'expert_in', 'uses', 'invested_in', 'interested_in');

CREATE TABLE IF NOT EXISTS "knowledge_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "type" "knowledge_node_type" NOT NULL,
  -- Normalized lowercase for dedup
  "name" text NOT NULL,
  -- Original casing for display
  "display_name" text NOT NULL,
  "description" text,
  -- Full-precision vector(1536) for cosine similarity
  "embedding" vector(1536),
  "mention_count" integer NOT NULL DEFAULT 1,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Dedup constraint: one node per (workspace, normalized_name, type)
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_nodes_name_workspace_uniq"
  ON "knowledge_nodes" ("workspace_id", "name", "type");

CREATE INDEX IF NOT EXISTS "knowledge_nodes_workspace_idx"
  ON "knowledge_nodes" ("workspace_id");

-- HNSW index for sub-ms approximate nearest neighbor search
-- m=16 (connections per node), ef_construction=64 (build quality)
CREATE INDEX IF NOT EXISTS "knowledge_nodes_embedding_idx"
  ON "knowledge_nodes" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS "knowledge_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "knowledge_node_id" uuid NOT NULL REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "relation_type" "knowledge_contact_rel_type" NOT NULL,
  -- 0.0–1.0 confidence score
  "strength" real NOT NULL DEFAULT 1.0,
  -- Incremented on repeated evidence, drives relevance ranking
  "evidence_count" integer NOT NULL DEFAULT 1,
  "last_evidence_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Idempotent upsert key: one link per (node, contact, relation_type)
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_contacts_node_contact_type_uniq"
  ON "knowledge_contacts" ("knowledge_node_id", "contact_id", "relation_type");

CREATE INDEX IF NOT EXISTS "knowledge_contacts_contact_idx"
  ON "knowledge_contacts" ("contact_id");

CREATE INDEX IF NOT EXISTS "knowledge_contacts_node_idx"
  ON "knowledge_contacts" ("knowledge_node_id");
