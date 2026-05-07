CREATE TYPE "public"."digest_focus" AS ENUM('balanced', 'commitments', 'relationships', 'deals');--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"brief_enabled" boolean DEFAULT true NOT NULL,
	"brief_time" integer DEFAULT 7 NOT NULL,
	"brief_days" text[] DEFAULT '{"mon","tue","wed","thu","fri"}' NOT NULL,
	"digest_focus" "digest_focus" DEFAULT 'balanced' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_prefs_user_workspace_idx" ON "user_preferences" USING btree ("user_id","workspace_id");