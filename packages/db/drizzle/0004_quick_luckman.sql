CREATE TYPE "public"."summary_status" AS ENUM('generating', 'ready', 'stale', 'failed');--> statement-breakpoint
CREATE TABLE "contact_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"summary" text,
	"model" text NOT NULL,
	"message_count" integer NOT NULL,
	"status" "summary_status" DEFAULT 'generating' NOT NULL,
	"bandit_trace_id" uuid,
	"style_variant" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_summaries" ADD CONSTRAINT "contact_summaries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_summaries" ADD CONSTRAINT "contact_summaries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;