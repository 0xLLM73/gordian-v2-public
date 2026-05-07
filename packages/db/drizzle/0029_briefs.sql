-- Migration 0029: briefs table for morning brief storage + bandit feedback loop
CREATE TABLE IF NOT EXISTS "briefs" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"     uuid NOT NULL REFERENCES "workspaces"("id"),
  "user_id"          uuid NOT NULL REFERENCES "users"("id"),
  "content"          text,
  "tone_trace_id"    uuid,
  "detail_trace_id"  uuid,
  "tone_variant"     text,
  "detail_variant"   text,
  "feedback"         boolean,
  "feedback_at"      timestamptz,
  "generated_at"     timestamptz DEFAULT now() NOT NULL,
  "created_at"       timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "briefs_workspace_user_idx"
  ON "briefs" ("workspace_id", "user_id");

CREATE INDEX IF NOT EXISTS "briefs_generated_at_idx"
  ON "briefs" ("generated_at" DESC);
