-- Migration 0031: semantic_patterns table for DBSCAN clustering output
-- Global table (no workspace_id) matching golden_dataset scope

CREATE TABLE semantic_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_domain VARCHAR(100) NOT NULL,
  pattern_text TEXT NOT NULL,
  embedding vector(1536),
  confidence_score REAL DEFAULT 0.5,
  last_reinforced TIMESTAMPTZ,
  occurrence_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for semantic similarity search
CREATE INDEX idx_semantic_patterns_embedding ON semantic_patterns
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- B-tree for feature domain filtering
CREATE INDEX idx_semantic_patterns_feature_domain ON semantic_patterns(feature_domain);

-- Composite index for top-patterns queries
CREATE INDEX idx_semantic_patterns_ranking ON semantic_patterns(confidence_score DESC, last_reinforced DESC NULLS LAST);
