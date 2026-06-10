ALTER TABLE "cadences"
	ADD COLUMN IF NOT EXISTS "template_version" integer;

ALTER TABLE "cadences"
	ADD COLUMN IF NOT EXISTS "template_source" text;

CREATE TABLE IF NOT EXISTS "follow_up_plan_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"source" text DEFAULT 'built_in' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"steps" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "follow_up_plan_template_versions_source_id_version_uniq"
	ON "follow_up_plan_template_versions" ("source", "template_id", "version");

CREATE INDEX IF NOT EXISTS "follow_up_plan_template_versions_active_idx"
	ON "follow_up_plan_template_versions" ("source", "is_active");

CREATE INDEX IF NOT EXISTS "follow_up_plan_template_versions_template_idx"
	ON "follow_up_plan_template_versions" ("template_id", "version");
