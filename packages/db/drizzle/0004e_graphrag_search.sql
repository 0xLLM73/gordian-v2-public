-- Migration: 0004e_graphrag_search.sql
-- GraphRAG 3-hop recursive CTE for causal intelligence (followup8).

CREATE OR REPLACE FUNCTION graphrag_search(
  p_workspace_id UUID,
  p_query_embedding vector(1536),
  p_max_depth INT DEFAULT 3,
  p_similarity_threshold FLOAT DEFAULT 0.2,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  raw_content TEXT,
  depth INT,
  semantic_distance FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE seeds AS (
    -- Pre-filter: top semantic matches (anchor candidates)
    SELECT
      ud.id,
      ud.raw_content,
      1 AS depth,
      (ud.embedding <=> p_query_embedding) AS semantic_distance
    FROM user_decisions ud
    WHERE ud.workspace_id = p_workspace_id
      AND (ud.embedding <=> p_query_embedding) < p_similarity_threshold
    ORDER BY semantic_distance ASC
    LIMIT p_limit
  ),
  traversal AS (
    -- Anchor: use pre-filtered seeds
    SELECT s.id, s.raw_content, s.depth, s.semantic_distance
    FROM seeds s

    UNION ALL

    -- Recursive: causal neighbors (parents and children)
    SELECT
      ud.id,
      ud.raw_content,
      t.depth + 1,
      (ud.embedding <=> p_query_embedding) AS semantic_distance
    FROM user_decisions ud
    JOIN causal_edges ce ON ud.id = ce.target_id OR ud.id = ce.source_id
    JOIN traversal t ON t.id = ce.source_id OR t.id = ce.target_id
    WHERE t.depth < p_max_depth
      AND ud.workspace_id = p_workspace_id
      AND ud.id <> t.id
  )
  SELECT DISTINCT ON (traversal.id)
    traversal.id,
    traversal.raw_content,
    traversal.depth,
    traversal.semantic_distance
  FROM traversal
  ORDER BY traversal.id, traversal.depth ASC;
END;
$$ LANGUAGE plpgsql;
