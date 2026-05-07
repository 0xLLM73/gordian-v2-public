-- GI1: goal_actions — Sprint 8 Wave 1
-- Strict 2-level goal decomposition: goals → goal_actions (atomic actions)
-- Encrypted: title, description (encryptedText custom type)

CREATE TYPE "public"."goal_action_status" AS ENUM('pending', 'in_progress', 'completed', 'skipped');
CREATE TYPE "public"."goal_action_type" AS ENUM('contact_outreach', 'information_gathering', 'document_creation', 'meeting_scheduling', 'decision_making');
CREATE TYPE "public"."goal_domain_tag" AS ENUM('financial', 'networking', 'legal', 'technical', 'operational', 'other');
CREATE TYPE "public"."goal_effort" AS ENUM('quick', 'medium', 'deep');

CREATE TABLE "goal_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"contact_id" uuid,
	"status" "goal_action_status" DEFAULT 'pending' NOT NULL,
	"action_type" "goal_action_type" NOT NULL,
	"domain_tag" "goal_domain_tag" NOT NULL,
	"effort" "goal_effort" DEFAULT 'medium' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);

ALTER TABLE "goal_actions" ADD CONSTRAINT "goal_actions_goal_id_goals_id_fk"
	FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goal_actions" ADD CONSTRAINT "goal_actions_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goal_actions" ADD CONSTRAINT "goal_actions_contact_id_contacts_id_fk"
	FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "goal_actions_goal_id_idx" ON "goal_actions" USING btree ("goal_id");
CREATE INDEX "goal_actions_workspace_id_idx" ON "goal_actions" USING btree ("workspace_id");
CREATE INDEX "goal_actions_contact_id_idx" ON "goal_actions" USING btree ("contact_id");
CREATE INDEX "goal_actions_status_idx" ON "goal_actions" USING btree ("status");
