-- Migration: 0043_semantic_cache.sql
-- P2: Semantic cache table for LLM response caching.
-- Lookup: exact hash match (fast path) then cosine similarity > 0.95.
-- Requires 0042_vector_512.sql (halfvec(512) standard).

CREATE TABLE IF NOT EXISTS semantic_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  query_embedding halfvec(512),
  query_hash TEXT NOT NULL,
  masked_query TEXT NOT NULL,
  response TEXT NOT NULL,
  tools_used TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour')
);

-- HNSW index for cosine similarity search (halfvec_cosine_ops)
CREATE INDEX semantic_cache_embedding_idx
  ON semantic_cache USING hnsw (query_embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- B-tree: exact hash lookup scoped to workspace
CREATE INDEX semantic_cache_workspace_hash_idx
  ON semantic_cache (workspace_id, query_hash);

-- B-tree: expired row cleanup
CREATE INDEX semantic_cache_expires_at_idx
  ON semantic_cache (expires_at);
