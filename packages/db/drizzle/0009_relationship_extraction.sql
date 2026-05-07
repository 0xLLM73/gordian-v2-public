-- Phase 13: Relationship Extraction
-- Creates contact_relationships table with unique constraint on the directed edge.

CREATE TYPE "public"."relationship_type" AS ENUM(
  'professional',
  'personal',
  'investor',
  'advisor',
  'co_investor',
  'introduced_by',
  'founder',
  'colleague',
  'other'
);

CREATE TYPE "public"."relationship_source" AS ENUM(
  'ai_extracted',
  'user_created',
  'inferred'
);

CREATE TABLE "contact_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "source_contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "target_contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "relationship_type" "relationship_type" NOT NULL,
  "strength" real DEFAULT 0.5 NOT NULL,
  "source" "relationship_source" DEFAULT 'ai_extracted' NOT NULL,
  "evidence" jsonb DEFAULT '{}',
  "notes" text,
  "sharing_level" text DEFAULT 'private' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Unique constraint: one edge per (workspace, source, target, type)
ALTER TABLE "contact_relationships"
ADD CONSTRAINT "unique_relationship_edge"
UNIQUE ("workspace_id", "source_contact_id", "target_contact_id", "relationship_type");

-- Query indexes
CREATE INDEX "cr_workspace_idx" ON "contact_relationships" ("workspace_id");
CREATE INDEX "cr_source_contact_idx" ON "contact_relationships" ("source_contact_id");
CREATE INDEX "cr_target_contact_idx" ON "contact_relationships" ("target_contact_id");
