-- Phase 29 v2: Calibration System — spec-aligned schema
-- Drops and recreates user_calibrations table + all 5 enum types.
-- Breaking change: enum values corrected, user_id added, priorities/industry_focus/ticket_size added.
-- Safe before any real data exists in this table.

-- Drop table first (releases enum type usage)
DROP TABLE IF EXISTS "user_calibrations";

-- Drop old enum types (created in 0022_calibration.sql with wrong values)
DROP TYPE IF EXISTS "communication_style";
DROP TYPE IF EXISTS "risk_tolerance";
DROP TYPE IF EXISTS "detail_preference";
DROP TYPE IF EXISTS "relationship_focus";
DROP TYPE IF EXISTS "decision_speed";

-- Recreate enum types with spec-correct values
CREATE TYPE "communication_style" AS ENUM ('formal', 'casual', 'direct', 'diplomatic');
CREATE TYPE "risk_tolerance" AS ENUM ('conservative', 'moderate', 'aggressive');
CREATE TYPE "detail_preference" AS ENUM ('high_level', 'balanced', 'granular');
CREATE TYPE "relationship_focus" AS ENUM ('breadth', 'balanced', 'depth');
CREATE TYPE "decision_speed" AS ENUM ('deliberate', 'moderate', 'fast');

-- Recreate user_calibrations table (spec v2)
CREATE TABLE "user_calibrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "communication_style" "communication_style" NOT NULL DEFAULT 'direct',
  "detail_preference" "detail_preference" NOT NULL DEFAULT 'balanced',
  "risk_tolerance" "risk_tolerance" NOT NULL DEFAULT 'moderate',
  "decision_speed" "decision_speed" NOT NULL DEFAULT 'moderate',
  "relationship_focus" "relationship_focus" NOT NULL DEFAULT 'balanced',
  "priorities" text[] NOT NULL DEFAULT '{}',
  "industry_focus" text[] NOT NULL DEFAULT '{}',
  -- Encrypted with AES-256-GCM using workspace DEK; stored as Base64 ciphertext
  "role_description" text,
  "investment_thesis" text,
  "ticket_size_min" integer,
  "ticket_size_max" integer,
  "calibration_version" integer NOT NULL DEFAULT 1,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- One calibration per user per workspace
CREATE UNIQUE INDEX "uq_calibration_user_workspace" ON "user_calibrations" ("user_id", "workspace_id");
CREATE INDEX "user_calibrations_workspace_idx" ON "user_calibrations" ("workspace_id");
CREATE INDEX "user_calibrations_user_idx" ON "user_calibrations" ("user_id");
