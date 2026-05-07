-- Phase 33: AI Recommendations
-- Deterministically scored action items for the user.
-- Lifecycle: pending → acted | dismissed | expired.
-- PII must NOT appear in the reasoning column.

CREATE TYPE "recommendation_type" AS ENUM (
  're_engage',
  'follow_up',
  'advance_deal',
  'make_intro',
  'achieve_goal'
);

CREATE TYPE "recommendation_status" AS ENUM (
  'pending',
  'acted',
  'dismissed',
  'expired'
);

CREATE TABLE IF NOT EXISTS "recommendations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  -- Nullable: some recommendations are workspace-level (not tied to a contact)
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE CASCADE,
  "type" "recommendation_type" NOT NULL,
  -- 0.0–1.0; adjusted by calibration boosts in the scoring engine
  "priority_score" real NOT NULL,
  -- Human-readable explanation — PII prohibited (validated by Nereid engine)
  "reasoning" text NOT NULL,
  "status" "recommendation_status" NOT NULL DEFAULT 'pending',
  -- NULL = never expires; set by the engine based on recommendation type
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Primary access pattern: pending recommendations for a workspace
CREATE INDEX IF NOT EXISTS "recommendations_workspace_status_idx"
  ON "recommendations" ("workspace_id", "status");

-- Filter by contact (e.g. contact detail panel)
CREATE INDEX IF NOT EXISTS "recommendations_contact_idx"
  ON "recommendations" ("contact_id");

-- Efficient expiry sweep — nightly worker scans this index
CREATE INDEX IF NOT EXISTS "recommendations_expires_at_idx"
  ON "recommendations" ("expires_at");
