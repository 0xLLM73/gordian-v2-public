-- Phase 25a: Cadence Engine
-- Adds cadence sequences with step-by-step outreach and auto-pause

-- Cadence status enums
DO $$ BEGIN
  CREATE TYPE "public"."cadence_status" AS ENUM('draft', 'active', 'paused', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."cadence_step_status" AS ENUM('pending', 'ready', 'sent', 'skipped', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Cadences table
CREATE TABLE IF NOT EXISTS "cadences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id"),
  "title" text NOT NULL,
  "template_id" text,
  "status" "cadence_status" DEFAULT 'draft' NOT NULL,
  "total_steps" integer DEFAULT 0 NOT NULL,
  "completed_steps" integer DEFAULT 0 NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb,
  "activated_at" timestamp with time zone,
  "paused_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Cadence steps table
CREATE TABLE IF NOT EXISTS "cadence_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cadence_id" uuid NOT NULL REFERENCES "cadences"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "step_number" integer NOT NULL,
  "prompt" text NOT NULL,
  "delay_hours" integer DEFAULT 24 NOT NULL,
  "status" "cadence_step_status" DEFAULT 'pending' NOT NULL,
  "draft_text" text,
  "arm_type" text,
  "sent_at" timestamp with time zone,
  "scheduled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes for cadences
CREATE INDEX IF NOT EXISTS "cadences_workspace_idx" ON "cadences" ("workspace_id");
CREATE INDEX IF NOT EXISTS "cadences_contact_idx" ON "cadences" ("workspace_id", "contact_id");
CREATE INDEX IF NOT EXISTS "cadences_status_idx" ON "cadences" ("workspace_id", "status");

-- Indexes for cadence_steps
CREATE INDEX IF NOT EXISTS "cadence_steps_cadence_idx" ON "cadence_steps" ("cadence_id");
CREATE INDEX IF NOT EXISTS "cadence_steps_status_idx" ON "cadence_steps" ("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "cadence_steps_scheduled_idx" ON "cadence_steps" ("scheduled_at");
