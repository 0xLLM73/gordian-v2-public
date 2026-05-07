-- Migration 0030: correction_diffs table + golden_dataset backfills
-- Supports: structured error analysis, DBSCAN clustering, contamination guard

-- 1. diff_type enum
CREATE TYPE diff_type AS ENUM (
  'hallucination',
  'missing_field',
  'format_error',
  'wrong_entity',
  'wrong_date',
  'wrong_type',
  'false_positive',
  'false_negative',
  'confidence_miscalibration',
  'other'
);

-- 2. correction_diffs table
CREATE TABLE correction_diffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  golden_id UUID NOT NULL REFERENCES golden_dataset(id) ON DELETE CASCADE,
  diff_type diff_type NOT NULL,
  severity_score INTEGER NOT NULL CHECK (severity_score BETWEEN 1 AND 10),
  description TEXT,
  mistake_embedding vector(1536),
  pattern_id UUID,
  analyzed_at TIMESTAMPTZ
);

-- 3. Indexes on correction_diffs
CREATE INDEX idx_correction_diffs_golden_id ON correction_diffs(golden_id);
CREATE INDEX idx_correction_diffs_pattern_id ON correction_diffs(pattern_id) WHERE pattern_id IS NOT NULL;
CREATE INDEX idx_correction_diffs_unclustered ON correction_diffs(analyzed_at DESC)
  WHERE mistake_embedding IS NOT NULL AND pattern_id IS NULL;

-- HNSW index for semantic similarity search on mistake embeddings
CREATE INDEX idx_correction_diffs_mistake_embedding ON correction_diffs
  USING hnsw (mistake_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. Backfill: HNSW index on golden_dataset.input_embedding (was missing)
CREATE INDEX IF NOT EXISTS idx_golden_dataset_input_embedding ON golden_dataset
  USING hnsw (input_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 5. Add input_context_hash column to golden_dataset (contamination guard)
ALTER TABLE golden_dataset ADD COLUMN IF NOT EXISTS input_context_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_golden_dataset_input_context_hash ON golden_dataset(input_context_hash)
  WHERE input_context_hash IS NOT NULL;
