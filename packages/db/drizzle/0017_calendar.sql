-- Phase 23: Google Calendar Integration
-- Adds calendar connections (encrypted OAuth tokens) and calendar events

-- Calendar connections table
CREATE TABLE IF NOT EXISTS "calendar_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "provider" text DEFAULT 'google' NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "expires_at" timestamp with time zone,
  "email" text,
  "last_sync_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Calendar events table
CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "connection_id" uuid NOT NULL REFERENCES "calendar_connections"("id") ON DELETE CASCADE,
  "external_id" text NOT NULL,
  "title" text,
  "description" text,
  "start_time" timestamp with time zone NOT NULL,
  "end_time" timestamp with time zone,
  "location" text,
  "contact_id" uuid REFERENCES "contacts"("id"),
  "attendees" jsonb DEFAULT '[]'::jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "calendar_connections_workspace_idx" ON "calendar_connections" ("workspace_id");
CREATE INDEX IF NOT EXISTS "calendar_events_workspace_idx" ON "calendar_events" ("workspace_id");
CREATE INDEX IF NOT EXISTS "calendar_events_external_idx" ON "calendar_events" ("connection_id", "external_id");
CREATE INDEX IF NOT EXISTS "calendar_events_contact_idx" ON "calendar_events" ("workspace_id", "contact_id");
CREATE INDEX IF NOT EXISTS "calendar_events_time_idx" ON "calendar_events" ("workspace_id", "start_time");
