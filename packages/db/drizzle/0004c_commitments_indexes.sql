-- Migration: 0004c_commitments_indexes.sql
-- Commitments table indexes for dedup and search.

-- Ensure pg_trgm extension for syntactic dedup (Stage 1)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- Create commitments table
CREATE TABLE IF NOT EXISTS commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  title TEXT NOT NULL,
  commitment_type commitment_type NOT NULL,
  status commitment_status NOT NULL DEFAULT 'draft',
  assignee TEXT NOT NULL,
  confidence REAL NOT NULL,
  due_date TIMESTAMPTZ,
  quote TEXT,
  embedding halfvec(1536),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- B-tree indexes
CREATE INDEX IF NOT EXISTS idx_commitments_workspace ON commitments (workspace_id);
CREATE INDEX IF NOT EXISTS idx_commitments_contact ON commitments (contact_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_commitments_due_date ON commitments (workspace_id, due_date)
  WHERE due_date IS NOT NULL;

-- GIN trigram index for syntactic dedup (Stage 1 of 3-stage funnel)
CREATE INDEX IF NOT EXISTS idx_commitments_title_trgm ON commitments
  USING gin (title gin_trgm_ops);

-- HNSW index for semantic dedup (Stage 2)
CREATE INDEX IF NOT EXISTS idx_commitments_embedding ON commitments
  USING hnsw (embedding halfvec_l2_ops) WITH (m = 16, ef_construction = 64);

-- Enable RLS
ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
