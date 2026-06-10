ALTER TABLE "cadences"
	ADD COLUMN IF NOT EXISTS "objective" text;

CREATE TABLE IF NOT EXISTS "follow_up_plan_draft_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
	"follow_up_plan_id" uuid NOT NULL REFERENCES "cadences"("id") ON DELETE CASCADE,
	"step_id" uuid NOT NULL REFERENCES "cadence_steps"("id") ON DELETE CASCADE,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'local_ai' NOT NULL,
	"draft_text" text NOT NULL,
	"arm_type" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "follow_up_plan_draft_revisions_step_version_uniq"
	ON "follow_up_plan_draft_revisions" ("workspace_id", "step_id", "version");

CREATE INDEX IF NOT EXISTS "follow_up_plan_draft_revisions_workspace_idx"
	ON "follow_up_plan_draft_revisions" ("workspace_id");

CREATE INDEX IF NOT EXISTS "follow_up_plan_draft_revisions_plan_idx"
	ON "follow_up_plan_draft_revisions" ("workspace_id", "follow_up_plan_id");

CREATE INDEX IF NOT EXISTS "follow_up_plan_draft_revisions_step_idx"
	ON "follow_up_plan_draft_revisions" ("workspace_id", "step_id");

CREATE INDEX IF NOT EXISTS "follow_up_plan_draft_revisions_status_idx"
	ON "follow_up_plan_draft_revisions" ("workspace_id", "status");

CREATE TABLE IF NOT EXISTS "follow_up_plan_send_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
	"follow_up_plan_id" uuid NOT NULL REFERENCES "cadences"("id") ON DELETE CASCADE,
	"step_id" uuid NOT NULL REFERENCES "cadence_steps"("id") ON DELETE CASCADE,
	"status" text NOT NULL,
	"channel" text DEFAULT 'manual' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"copied_at" timestamp with time zone,
	"telegram_opened_at" timestamp with time zone,
	"manual_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "follow_up_plan_send_records_workspace_idx"
	ON "follow_up_plan_send_records" ("workspace_id");

CREATE INDEX IF NOT EXISTS "follow_up_plan_send_records_plan_idx"
	ON "follow_up_plan_send_records" ("workspace_id", "follow_up_plan_id");

CREATE INDEX IF NOT EXISTS "follow_up_plan_send_records_step_idx"
	ON "follow_up_plan_send_records" ("workspace_id", "step_id");

CREATE INDEX IF NOT EXISTS "follow_up_plan_send_records_status_idx"
	ON "follow_up_plan_send_records" ("workspace_id", "status");

CREATE TABLE IF NOT EXISTS "follow_up_plan_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
	"follow_up_plan_id" uuid NOT NULL REFERENCES "cadences"("id") ON DELETE CASCADE,
	"step_id" uuid REFERENCES "cadence_steps"("id") ON DELETE SET NULL,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "follow_up_plan_activity_workspace_idx"
	ON "follow_up_plan_activity_events" ("workspace_id");

CREATE INDEX IF NOT EXISTS "follow_up_plan_activity_plan_created_idx"
	ON "follow_up_plan_activity_events" ("workspace_id", "follow_up_plan_id", "created_at");

CREATE INDEX IF NOT EXISTS "follow_up_plan_activity_step_idx"
	ON "follow_up_plan_activity_events" ("workspace_id", "step_id");

ALTER TABLE "follow_up_plan_draft_revisions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON "follow_up_plan_draft_revisions";
CREATE POLICY workspace_isolation ON "follow_up_plan_draft_revisions"
	FOR ALL
	USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE "follow_up_plan_send_records" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON "follow_up_plan_send_records";
CREATE POLICY workspace_isolation ON "follow_up_plan_send_records"
	FOR ALL
	USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE "follow_up_plan_activity_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON "follow_up_plan_activity_events";
CREATE POLICY workspace_isolation ON "follow_up_plan_activity_events"
	FOR ALL
	USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
