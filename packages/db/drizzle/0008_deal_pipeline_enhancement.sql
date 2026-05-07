-- Phase 11: Deal Pipeline Enhancement
-- Creates new enums, adds columns to deals, creates deal_participants and deal_artifacts tables
-- Then migrates existing deal_status data to new deal_stage values

-- Step 1: Create new enums
CREATE TYPE "deal_stage" AS ENUM ('discovery', 'diligence', 'negotiation', 'committed', 'won', 'lost');
CREATE TYPE "deal_type" AS ENUM ('investment', 'advisory', 'partnership', 'token', 'other');
CREATE TYPE "deal_source" AS ENUM ('manual', 'detected');
CREATE TYPE "deal_participant_role" AS ENUM ('lead', 'co_investor', 'advisor', 'counterparty', 'introducer', 'other');
CREATE TYPE "deal_artifact_type" AS ENUM ('term_sheet', 'saft', 'token_warrant', 'cap_table', 'contract', 'presentation', 'note', 'other');

-- Step 2: Add new columns to deals table
ALTER TABLE "deals" ADD COLUMN "deal_type" "deal_type" DEFAULT 'other' NOT NULL;
ALTER TABLE "deals" ADD COLUMN "stage" "deal_stage" DEFAULT 'discovery' NOT NULL;
ALTER TABLE "deals" ADD COLUMN "source" "deal_source" DEFAULT 'manual' NOT NULL;
ALTER TABLE "deals" ADD COLUMN "terms" jsonb DEFAULT '{}'::jsonb;
ALTER TABLE "deals" ADD COLUMN "stage_history" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "deals" ADD COLUMN "closed_at" timestamp with time zone;
ALTER TABLE "deals" ADD COLUMN "sharing_level" text DEFAULT 'private' NOT NULL;
ALTER TABLE "deals" ADD COLUMN "data_classification" text;

-- Step 3: Migrate old deal_status values to new deal_stage values
-- Mapping: open -> discovery, negotiating -> negotiation, won -> won, lost -> lost
UPDATE "deals" SET "stage" = CASE
  WHEN "status" = 'open' THEN 'discovery'::deal_stage
  WHEN "status" = 'negotiating' THEN 'negotiation'::deal_stage
  WHEN "status" = 'won' THEN 'won'::deal_stage
  WHEN "status" = 'lost' THEN 'lost'::deal_stage
  ELSE 'discovery'::deal_stage
END;

-- Set closedAt for terminal deals
UPDATE "deals" SET "closed_at" = "updated_at" WHERE "status" IN ('won', 'lost');

-- Initialize stage_history from current stage
UPDATE "deals" SET "stage_history" = jsonb_build_array(
  jsonb_build_object('stage', "stage"::text, 'timestamp', to_char("created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- Step 4: Drop old status column
ALTER TABLE "deals" DROP COLUMN "status";

-- Step 5: Add indexes for new columns
CREATE INDEX IF NOT EXISTS "deals_stage_idx" ON "deals" ("stage");
CREATE INDEX IF NOT EXISTS "deals_type_idx" ON "deals" ("deal_type");

-- Step 6: Create deal_participants table
CREATE TABLE IF NOT EXISTS "deal_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "deal_id" uuid NOT NULL REFERENCES "deals"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id"),
  "role" "deal_participant_role" DEFAULT 'other' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sharing_level" text DEFAULT 'private' NOT NULL,
  "data_classification" text
);
CREATE INDEX IF NOT EXISTS "deal_participants_deal_idx" ON "deal_participants" ("deal_id");
CREATE INDEX IF NOT EXISTS "deal_participants_contact_idx" ON "deal_participants" ("contact_id");

-- Step 7: Create deal_artifacts table
CREATE TABLE IF NOT EXISTS "deal_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "deal_id" uuid NOT NULL REFERENCES "deals"("id") ON DELETE CASCADE,
  "artifact_type" "deal_artifact_type" DEFAULT 'other' NOT NULL,
  "title" text NOT NULL,
  "url" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sharing_level" text DEFAULT 'private' NOT NULL,
  "data_classification" text
);
CREATE INDEX IF NOT EXISTS "deal_artifacts_deal_idx" ON "deal_artifacts" ("deal_id");
CREATE INDEX IF NOT EXISTS "deal_artifacts_type_idx" ON "deal_artifacts" ("artifact_type");
