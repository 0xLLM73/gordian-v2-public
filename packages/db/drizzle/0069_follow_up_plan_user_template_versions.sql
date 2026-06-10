CREATE TABLE IF NOT EXISTS "follow_up_plan_user_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"steps" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "follow_up_plan_user_template_versions_workspace_id_version_uniq"
	ON "follow_up_plan_user_template_versions" ("workspace_id", "template_id", "version");

CREATE INDEX IF NOT EXISTS "follow_up_plan_user_template_versions_workspace_idx"
	ON "follow_up_plan_user_template_versions" ("workspace_id");

CREATE INDEX IF NOT EXISTS "follow_up_plan_user_template_versions_active_idx"
	ON "follow_up_plan_user_template_versions" ("workspace_id", "is_active");

ALTER TABLE "follow_up_plan_user_template_versions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON "follow_up_plan_user_template_versions";
CREATE POLICY workspace_isolation ON "follow_up_plan_user_template_versions"
	FOR ALL
	USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
