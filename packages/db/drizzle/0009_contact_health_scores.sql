-- Phase 14: Contact Health Scoring
-- Creates the contact_health_scores table with a unique constraint per (workspace_id, contact_id)

CREATE TABLE IF NOT EXISTS "contact_health_scores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id"),
  "recency" real DEFAULT 0 NOT NULL,
  "frequency" real DEFAULT 0 NOT NULL,
  "fulfillment" real DEFAULT 0 NOT NULL,
  "responsiveness" real DEFAULT 0 NOT NULL,
  "reciprocity" real DEFAULT 0 NOT NULL,
  "depth" real DEFAULT 0 NOT NULL,
  "composite" real DEFAULT 0 NOT NULL,
  "label" text DEFAULT 'dormant' NOT NULL,
  "trend" text DEFAULT 'stable' NOT NULL,
  "previous_composite" real,
  "computation_data" jsonb DEFAULT '{}',
  "computed_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "sharing_level" text DEFAULT 'private' NOT NULL
);

ALTER TABLE "contact_health_scores"
  ADD CONSTRAINT "unique_health_score_per_contact"
  UNIQUE ("workspace_id", "contact_id");
