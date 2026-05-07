-- Migration: 0012_encrypt_pii_fix.sql
-- Update hybrid_search() to return content_sanitized instead of content.
-- After encrypting memories.content (SEC-005), the raw column returns ciphertext.
-- content_sanitized is the ELM-masked plaintext — correct value for AI/UI display.

CREATE OR REPLACE FUNCTION hybrid_search(
  p_workspace_id UUID,
  p_query_embedding halfvec(1536),
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
  -- Set dynamic ef_search for this transaction (followup4)
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
  -- Reciprocal Rank Fusion (pillar7)
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
