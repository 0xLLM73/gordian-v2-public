-- Migration: 0004_memories.sql
-- Partitioned memories table with 23 partitions by category.
-- Each partition gets an independent HNSW index for halfvec(1536).
-- CRITICAL: Do NOT use drizzle-kit push — this table uses features
-- (partitioning, halfvec, HNSW) that Drizzle cannot express.

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Partitioned memories table (followup4)
CREATE TABLE IF NOT EXISTS memories (
  id UUID DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  contact_id UUID REFERENCES contacts(id),
  category memory_category NOT NULL,
  content TEXT NOT NULL,
  content_sanitized TEXT,
  embedding halfvec(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (id, category)
) PARTITION BY LIST (category);

-- Create partitions for each of the 23 memory categories
CREATE TABLE memories_general PARTITION OF memories FOR VALUES IN ('general');
CREATE TABLE memories_preference PARTITION OF memories FOR VALUES IN ('preference');
CREATE TABLE memories_commitment PARTITION OF memories FOR VALUES IN ('commitment');
CREATE TABLE memories_relationship PARTITION OF memories FOR VALUES IN ('relationship');
CREATE TABLE memories_financial PARTITION OF memories FOR VALUES IN ('financial');
CREATE TABLE memories_technical PARTITION OF memories FOR VALUES IN ('technical');
CREATE TABLE memories_emotional PARTITION OF memories FOR VALUES IN ('emotional');
CREATE TABLE memories_temporal PARTITION OF memories FOR VALUES IN ('temporal');
CREATE TABLE memories_location PARTITION OF memories FOR VALUES IN ('location');
CREATE TABLE memories_organization PARTITION OF memories FOR VALUES IN ('organization');
CREATE TABLE memories_project PARTITION OF memories FOR VALUES IN ('project');
CREATE TABLE memories_event PARTITION OF memories FOR VALUES IN ('event');
CREATE TABLE memories_communication_style PARTITION OF memories FOR VALUES IN ('communication_style');
CREATE TABLE memories_decision_pattern PARTITION OF memories FOR VALUES IN ('decision_pattern');
CREATE TABLE memories_risk_tolerance PARTITION OF memories FOR VALUES IN ('risk_tolerance');
CREATE TABLE memories_goal PARTITION OF memories FOR VALUES IN ('goal');
CREATE TABLE memories_constraint PARTITION OF memories FOR VALUES IN ('constraint');
CREATE TABLE memories_expertise PARTITION OF memories FOR VALUES IN ('expertise');
CREATE TABLE memories_interest PARTITION OF memories FOR VALUES IN ('interest');
CREATE TABLE memories_conflict PARTITION OF memories FOR VALUES IN ('conflict');
CREATE TABLE memories_agreement PARTITION OF memories FOR VALUES IN ('agreement');
CREATE TABLE memories_status_update PARTITION OF memories FOR VALUES IN ('status_update');
CREATE TABLE memories_context PARTITION OF memories FOR VALUES IN ('context');

-- HNSW index per partition (followup4: m=16, ef_construction=64)
-- Using halfvec_l2_ops for halfvec columns
DO $$
DECLARE
  partition_name TEXT;
BEGIN
  FOR partition_name IN
    SELECT tablename FROM pg_tables
    WHERE tablename LIKE 'memories_%' AND schemaname = 'public'
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_embedding ON %I USING hnsw (embedding halfvec_l2_ops) WITH (m = 16, ef_construction = 64)',
      partition_name, partition_name
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_workspace ON %I (workspace_id)',
      partition_name, partition_name
    );
  END LOOP;
END $$;

-- Enable RLS
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
