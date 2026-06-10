CREATE TABLE IF NOT EXISTS "contact_health_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
	"contact_id" uuid NOT NULL REFERENCES "contacts"("id"),
	"user_id" uuid REFERENCES "users"("id"),
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"status_reason_code" text,
	"snoozed_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "contact_health_feedback_workspace_contact_idx"
	ON "contact_health_feedback" ("workspace_id", "contact_id");

CREATE INDEX IF NOT EXISTS "contact_health_feedback_workspace_action_idx"
	ON "contact_health_feedback" ("workspace_id", "action");

CREATE INDEX IF NOT EXISTS "contact_health_feedback_snoozed_until_idx"
	ON "contact_health_feedback" ("snoozed_until");
