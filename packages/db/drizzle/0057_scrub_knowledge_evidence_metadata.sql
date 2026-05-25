-- Remove plaintext entity names from plain JSON knowledge evidence metadata.
-- Knowledge node names/descriptions and evidence snippets are encrypted columns,
-- but metadata is intentionally queryable JSONB, so it must not carry raw
-- extracted entity names or raw matched terms.

UPDATE knowledge_evidence
SET metadata = jsonb_strip_nulls((metadata - 'normalizedName') #- '{sourceMessageSelection,matchedTerm}')
WHERE metadata IS NOT NULL
  AND (
    metadata ? 'normalizedName'
    OR metadata #> '{sourceMessageSelection,matchedTerm}' IS NOT NULL
  );
