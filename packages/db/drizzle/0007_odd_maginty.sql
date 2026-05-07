CREATE TYPE "public"."digest_period" AS ENUM('today', 'yesterday', '3d', 'week', 'custom');--> statement-breakpoint
CREATE TYPE "public"."digest_status" AS ENUM('generating', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."digest_focus" ADD VALUE 'network';--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period" "digest_period" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"content" text,
	"sections" jsonb,
	"status" "digest_status" DEFAULT 'generating' NOT NULL,
	"model" text,
	"message_count" integer,
	"contact_count" integer,
	"style_trace_id" uuid,
	"tone_trace_id" uuid,
	"style_variant" text,
	"tone_variant" text,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;