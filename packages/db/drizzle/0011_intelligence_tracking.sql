-- Phase 16/19/24: Intelligence & Tracking
-- Creates introductions, goals, and user_behaviors tables.

CREATE TYPE "public"."intro_status" AS ENUM(
  'detected',
  'confirmed',
  'accepted',
  'active',
  'completed',
  'scored',
  'dismissed'
);

CREATE TYPE "public"."intro_context" AS ENUM(
  'deal',
  'hiring',
  'knowledge',
  'social',
  'other'
);

CREATE TYPE "public"."goal_type" AS ENUM(
  'relationship',
  'business',
  'habit',
  'network'
);

CREATE TYPE "public"."goal_status" AS ENUM(
  'active',
  'paused',
  'completed',
  'abandoned'
);

CREATE TABLE "introductions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "introducer_contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "introduced_contact_id_1" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "introduced_contact_id_2" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "context" "intro_context" DEFAULT 'other' NOT NULL,
  "confidence" real NOT NULL,
  "status" "intro_status" DEFAULT 'detected' NOT NULL,
  "status_history" jsonb DEFAULT '[]' NOT NULL,
  "note" text,
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sharing_level" text DEFAULT 'private' NOT NULL
);

CREATE INDEX "introductions_workspace_introducer_idx" ON "introductions" ("workspace_id", "introducer_contact_id");
CREATE INDEX "introductions_workspace_status_idx" ON "introductions" ("workspace_id", "status");

CREATE TABLE "goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "type" "goal_type" NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "target_count" integer NOT NULL,
  "current_count" integer DEFAULT 0 NOT NULL,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "status" "goal_status" DEFAULT 'active' NOT NULL,
  "target_date" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE INDEX "goals_workspace_status_idx" ON "goals" ("workspace_id", "status");
CREATE INDEX "goals_workspace_type_idx" ON "goals" ("workspace_id", "type");

CREATE TABLE "user_behaviors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL,
  "event" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "user_behaviors_workspace_created_idx" ON "user_behaviors" ("workspace_id", "created_at");
CREATE INDEX "user_behaviors_workspace_event_idx" ON "user_behaviors" ("workspace_id", "event");
