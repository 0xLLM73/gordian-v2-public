CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid REFERENCES "workspaces"("id"),
  "key" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "updated_by" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "feature_flags_key_idx" ON "feature_flags" ("key");
CREATE INDEX IF NOT EXISTS "feature_flags_workspace_idx" ON "feature_flags" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_workspace_uniq" ON "feature_flags" ("key", "workspace_id");
-- Enforce at most one global flag per key (NULL != NULL in standard unique indexes)
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_global_key_uniq" ON "feature_flags" ("key") WHERE "workspace_id" IS NULL;
