-- Phase 18: Draft Generation — creates draft_arm enum and draft_logs table

CREATE TYPE "draft_arm" AS ENUM ('casual_nudge', 'professional_value', 'direct_ask', 'soft_memory');

CREATE TABLE IF NOT EXISTS "draft_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id"),
  "arm_type" "draft_arm" NOT NULL,
  "generated_text" text NOT NULL,
  "edited_text" text,
  "edit_distance" integer,
  "was_sent" boolean DEFAULT false NOT NULL,
  "was_discarded" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "sent_at" timestamptz
);
