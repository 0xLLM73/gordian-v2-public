-- Phase 29: Calibration System
-- User calibration profile per workspace — one record per workspace.
-- Stores 5 behavioral enum signals + 2 encrypted free-text fields.
-- Used to personalize AI kernel system prompts across all 4 AI modules.
-- Encrypted fields (role_description, investment_thesis) use AES-256-GCM via DEK.

CREATE TYPE "communication_style" AS ENUM ('direct', 'diplomatic', 'analytical', 'storyteller');
CREATE TYPE "risk_tolerance" AS ENUM ('conservative', 'moderate', 'aggressive', 'opportunistic');
CREATE TYPE "detail_preference" AS ENUM ('high_level', 'balanced', 'detailed', 'exhaustive');
CREATE TYPE "relationship_focus" AS ENUM ('deal_oriented', 'relationship_first', 'community', 'selective');
CREATE TYPE "decision_speed" AS ENUM ('fast', 'deliberate', 'consensus', 'opportunistic');

CREATE TABLE IF NOT EXISTS "user_calibrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "version" integer NOT NULL DEFAULT 1,
  "communication_style" "communication_style",
  "risk_tolerance" "risk_tolerance",
  "detail_preference" "detail_preference",
  "relationship_focus" "relationship_focus",
  "decision_speed" "decision_speed",
  -- Encrypted with AES-256-GCM using workspace DEK; stored as Base64 ciphertext
  "role_description" text,
  "investment_thesis" text,
  -- Set when all 5 enum fields are populated
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- One calibration per workspace (unique constraint enables upsert)
CREATE UNIQUE INDEX IF NOT EXISTS "user_calibrations_workspace_uniq" ON "user_calibrations" ("workspace_id");
CREATE INDEX IF NOT EXISTS "user_calibrations_workspace_idx" ON "user_calibrations" ("workspace_id");
