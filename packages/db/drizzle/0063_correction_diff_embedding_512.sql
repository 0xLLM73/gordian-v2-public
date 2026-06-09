-- Align correction_diffs mistake embeddings with the local 512-dimension model setup.
--
-- 0042_vector_512.sql migrated the other derived embedding columns to halfvec(512),
-- but correction_diffs.mistake_embedding still remained vector(1536). The local
-- embedding runtime now emits 512-dimensional vectors, so diff embedding backfill
-- fails unless this column is migrated too.

DROP INDEX IF EXISTS idx_correction_diffs_mistake_embedding;

ALTER TABLE correction_diffs
  ALTER COLUMN mistake_embedding TYPE halfvec(512)
  USING mistake_embedding::halfvec(512);

CREATE INDEX idx_correction_diffs_mistake_embedding
  ON correction_diffs USING hnsw (mistake_embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);
