-- Migration: 0004b_decision_graph.sql
-- Decision graph tables for causal intelligence (followup8).
-- user_decisions + causal_edges form a directed graph for GraphRAG.

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Decision nodes
CREATE TABLE IF NOT EXISTS user_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id),
  raw_content TEXT NOT NULL,
  embedding vector(1536),
  decision_type decision_type NOT NULL,
  interaction_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Causal edges
CREATE TABLE IF NOT EXISTS causal_edges (
  source_id UUID NOT NULL REFERENCES user_decisions(id),
  target_id UUID NOT NULL REFERENCES user_decisions(id),
  weight FLOAT NOT NULL DEFAULT 0.5,
  edge_type edge_type NOT NULL,
  confidence_score FLOAT NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (source_id, target_id)
);

-- HNSW index for semantic search on decisions
CREATE INDEX IF NOT EXISTS idx_user_decisions_embedding
  ON user_decisions USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- B-tree indexes for graph traversal
CREATE INDEX IF NOT EXISTS idx_causal_edges_source ON causal_edges (source_id);
CREATE INDEX IF NOT EXISTS idx_causal_edges_target ON causal_edges (target_id);
CREATE INDEX IF NOT EXISTS idx_user_decisions_workspace ON user_decisions (workspace_id, created_at DESC);

-- Enable RLS
ALTER TABLE user_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE causal_edges ENABLE ROW LEVEL SECURITY;
