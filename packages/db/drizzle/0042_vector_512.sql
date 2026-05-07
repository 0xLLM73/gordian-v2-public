-- Migration: 0042_vector_512.sql
-- P3: Migrate embedding columns from 1536→512 dimensions (halfvec).
-- Uses Matryoshka truncation property of text-embedding-3-small — the first
-- 512 dimensions preserve quality. 67% storage savings + faster HNSW scans.
--
-- NOTE: After this migration, run the backfill script to re-embed with
-- dimensions=512 from the OpenAI API. The USING cast truncates in-place
-- as a stopgap, but proper re-embedding produces higher-quality vectors.

-- ── 1. Drop HNSW indexes before column type changes ─────────────────────────

-- PostgreSQL attempts to preserve existing indexes during ALTER COLUMN TYPE.
-- Drop vector indexes first so vector_cosine_ops is not applied to halfvec.
DROP INDEX IF EXISTS knowledge_nodes_embedding_idx;
DROP INDEX IF EXISTS outcomes_embedding_idx;
DROP INDEX IF EXISTS idx_commitments_embedding;
DROP INDEX IF EXISTS idx_semantic_patterns_embedding;

-- ── 2. ALTER embedding columns ───────────────────────────────────────────────

-- memories (partitioned — ALTER on parent cascades to all partitions)
ALTER TABLE memories ALTER COLUMN embedding TYPE halfvec(512) USING embedding::halfvec(512);

-- knowledge_nodes (was vector(1536))
ALTER TABLE knowledge_nodes ALTER COLUMN embedding TYPE halfvec(512) USING embedding::halfvec(512);

-- outcomes (was vector(1536))
ALTER TABLE outcomes ALTER COLUMN embedding TYPE halfvec(512) USING embedding::halfvec(512);

-- commitments (was halfvec(1536))
ALTER TABLE commitments ALTER COLUMN embedding TYPE halfvec(512) USING embedding::halfvec(512);

-- semantic_patterns (was vector(1536))
ALTER TABLE semantic_patterns ALTER COLUMN embedding TYPE halfvec(512) USING embedding::halfvec(512);

-- ── 3. Recreate HNSW indexes with halfvec_cosine_ops ─────────────────────────

-- knowledge_nodes (was vector_cosine_ops, from 0023)
CREATE INDEX knowledge_nodes_embedding_idx
  ON knowledge_nodes USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- outcomes (was vector_cosine_ops, from 0027)
CREATE INDEX outcomes_embedding_idx
  ON outcomes USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- commitments (was halfvec_l2_ops, from 0004c — switch to cosine for consistency)
CREATE INDEX idx_commitments_embedding
  ON commitments USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- semantic_patterns (was vector_cosine_ops, from 0031)
CREATE INDEX idx_semantic_patterns_embedding
  ON semantic_patterns USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- memories partition indexes: recreated per-partition
-- The partition indexes use halfvec_l2_ops (from 0004_memories.sql).
-- They auto-adapt when the parent column type changes via ALTER TABLE.
-- Re-run the partition index creation to ensure correct ops class:
DO $$
DECLARE
  part RECORD;
BEGIN
  FOR part IN
    SELECT inhrelid::regclass::text AS partition_name
    FROM pg_inherits
    WHERE inhparent = 'memories'::regclass
  LOOP
    EXECUTE format(
      'DROP INDEX IF EXISTS idx_%s_embedding',
      replace(part.partition_name, 'memories_', '')
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_embedding ON %s USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)',
      replace(part.partition_name, 'memories_', ''),
      part.partition_name
    );
  END LOOP;
END $$;

-- ── 4. ALTER SQL functions to use halfvec(512) ──────────────────────────────

-- hybrid_search: p_query_embedding halfvec(1536) → halfvec(512)
CREATE OR REPLACE FUNCTION hybrid_search(
  p_workspace_id UUID,
  p_query_embedding halfvec(512),
  p_query_text TEXT,
  p_category memory_category DEFAULT NULL,
  p_limit INT DEFAULT 10,
  p_rrf_k INT DEFAULT 60
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  category memory_category,
  rrf_score FLOAT,
  semantic_score FLOAT,
  fts_rank FLOAT
) AS $$
BEGIN
  PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
  PERFORM set_config('hnsw.ef_search', '40', true);

  RETURN QUERY
  WITH semantic AS (
    SELECT
      m.id,
      m.content_sanitized AS content,
      m.category,
      1 - (m.embedding <=> p_query_embedding) AS score,
      ROW_NUMBER() OVER (ORDER BY m.embedding <=> p_query_embedding) AS rank
    FROM memories m
    WHERE m.workspace_id = p_workspace_id
      AND (p_category IS NULL OR m.category = p_category)
    ORDER BY m.embedding <=> p_query_embedding
    LIMIT p_limit * 3
  ),
  fulltext AS (
    SELECT
      m.id,
      m.content_sanitized AS content,
      m.category,
      ts_rank(to_tsvector('english', m.content_sanitized), plainto_tsquery('english', p_query_text)) AS score,
      ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('english', m.content_sanitized), plainto_tsquery('english', p_query_text)) DESC) AS rank
    FROM memories m
    WHERE m.workspace_id = p_workspace_id
      AND (p_category IS NULL OR m.category = p_category)
      AND to_tsvector('english', m.content_sanitized) @@ plainto_tsquery('english', p_query_text)
    LIMIT p_limit * 3
  ),
  rrf AS (
    SELECT
      COALESCE(s.id, f.id) AS id,
      COALESCE(s.content, f.content) AS content,
      COALESCE(s.category, f.category) AS category,
      (COALESCE(1.0 / (p_rrf_k + s.rank), 0) +
       COALESCE(1.0 / (p_rrf_k + f.rank), 0))::FLOAT AS rrf_score,
      COALESCE(s.score, 0)::FLOAT AS semantic_score,
      COALESCE(f.score, 0)::FLOAT AS fts_rank
    FROM semantic s
    FULL OUTER JOIN fulltext f ON s.id = f.id
  )
  SELECT r.id, r.content, r.category, r.rrf_score, r.semantic_score, r.fts_rank
  FROM rrf r
  ORDER BY r.rrf_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- graphrag_search: NOT altered in this migration.
-- user_decisions.embedding stays at vector(1536) — graphrag_search keeps its
-- existing vector(1536) param until user_decisions migrates to halfvec(512).
