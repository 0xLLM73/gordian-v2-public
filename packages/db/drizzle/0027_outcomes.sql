-- Phase 35: Outcome Scoring / Precedent AI
-- Records terminal events (deal closed, commitment fulfilled/missed, goal completed,
-- intro connected) for historical precedent search via cosine similarity.
--
-- PII guard: context_labels stores category labels only — no contact names, handles,
-- or Telegram IDs. notes is stored as ciphertext via encryptedText custom type.
-- Embeddings are derived from context_labels, never from raw notes.

CREATE TYPE "outcome_type" AS ENUM (
  'deal_closed',
  'commitment_fulfilled',
  'commitment_missed',
  'goal_completed',
  'intro_connected'
);

CREATE TYPE "outcome_result" AS ENUM (
  'positive',
  'negative',
  'neutral'
);

CREATE TABLE IF NOT EXISTS "outcomes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  -- Nullable: workspace-level outcomes (e.g. goal_completed) have no contact
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE CASCADE,
  "type" "outcome_type" NOT NULL,
  "result" "outcome_result" NOT NULL,
  -- Category labels only — no PII (e.g. ['defi', 'token_sale', '45d_cycle'])
  "context_labels" text[] NOT NULL DEFAULT '{}',
  -- Optional user-facing notes — always encrypted (AES-256-GCM via encryptedText)
  "notes" text,
  -- Full-precision vector(1536) — derived from context_labels, never from raw notes
  "embedding" vector(1536),
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Primary access pattern: list outcomes by workspace + type
CREATE INDEX IF NOT EXISTS "outcomes_workspace_type_idx"
  ON "outcomes" ("workspace_id", "type");

-- Contact detail panel: list outcomes for a specific contact
CREATE INDEX IF NOT EXISTS "outcomes_workspace_contact_idx"
  ON "outcomes" ("workspace_id", "contact_id");

-- Chronological sort: recent outcomes first
CREATE INDEX IF NOT EXISTS "outcomes_occurred_at_idx"
  ON "outcomes" ("occurred_at");

-- HNSW index for sub-ms approximate nearest neighbor precedent search
-- m=16 (connections per node), ef_construction=64 (build quality)
CREATE INDEX IF NOT EXISTS "outcomes_embedding_idx"
  ON "outcomes" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
