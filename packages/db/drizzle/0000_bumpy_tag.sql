CREATE TYPE "public"."commitment_status" AS ENUM('active', 'completed', 'dismissed', 'draft');--> statement-breakpoint
CREATE TYPE "public"."commitment_type" AS ENUM('promise', 'task', 'meeting', 'financial');--> statement-breakpoint
CREATE TYPE "public"."correction_source" AS ENUM('user_edit', 'expert_review', 'implicit_signal');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('open', 'negotiating', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."decision_type" AS ENUM('message', 'click', 'view', 'purchase', 'commitment', 'dismissal');--> statement-breakpoint
CREATE TYPE "public"."difficulty_tier" AS ENUM('trivial', 'standard', 'edge_case');--> statement-breakpoint
CREATE TYPE "public"."edge_type" AS ENUM('explicit_reply', 'implicit_context', 'temporal', 'semantic');--> statement-breakpoint
CREATE TYPE "public"."memory_category" AS ENUM('general', 'preference', 'commitment', 'relationship', 'financial', 'technical', 'emotional', 'temporal', 'location', 'organization', 'project', 'event', 'communication_style', 'decision_pattern', 'risk_tolerance', 'goal', 'constraint', 'expertise', 'interest', 'conflict', 'agreement', 'status_update', 'context');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"encrypted_wrk" text NOT NULL,
	"kms_context" jsonb NOT NULL,
	"wrk_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"telegram_id" text,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"email" text,
	"notes" text,
	"first_name_bidx" text,
	"last_name_bidx" text,
	"phone_bidx" text,
	"email_bidx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid,
	"category" "memory_category" NOT NULL,
	"content" text NOT NULL,
	"content_sanitized" text,
	"embedding" halfvec(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"title" text NOT NULL,
	"commitment_type" "commitment_type" NOT NULL,
	"status" "commitment_status" DEFAULT 'draft' NOT NULL,
	"assignee" text NOT NULL,
	"confidence" real NOT NULL,
	"due_date" timestamp with time zone,
	"quote" text,
	"embedding" halfvec(1536),
	"bandit_trace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "causal_edges" (
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"weight" real DEFAULT 0.5 NOT NULL,
	"edge_type" "edge_type" NOT NULL,
	"confidence_score" real DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"raw_content" text NOT NULL,
	"embedding" vector(1536),
	"decision_type" "decision_type" NOT NULL,
	"interaction_metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "deal_status" DEFAULT 'open' NOT NULL,
	"value" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bandit_ledger" (
	"trace_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_variant" varchar(50) NOT NULL,
	"feature_context" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reward_score" real DEFAULT 0,
	"is_finalized" boolean DEFAULT false,
	"user_id" uuid,
	"outcome_type" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "golden_dataset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_domain" varchar(100) NOT NULL,
	"input_context" text NOT NULL,
	"input_embedding" vector(1536),
	"model_prediction" jsonb NOT NULL,
	"prediction_metadata" jsonb,
	"corrected_output" jsonb NOT NULL,
	"correction_reasoning" text,
	"tags" text[],
	"difficulty" "difficulty_tier" DEFAULT 'standard',
	"source" "correction_source" DEFAULT 'user_edit',
	"status" "verification_status" DEFAULT 'pending',
	"verified_by" uuid,
	"verification_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_interaction_id" uuid
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_edges" ADD CONSTRAINT "causal_edges_source_id_user_decisions_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."user_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causal_edges" ADD CONSTRAINT "causal_edges_target_id_user_decisions_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."user_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_decisions" ADD CONSTRAINT "user_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_decisions" ADD CONSTRAINT "user_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_dataset" ADD CONSTRAINT "golden_dataset_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contacts_workspace_idx" ON "contacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "contacts_first_name_bidx_idx" ON "contacts" USING btree ("first_name_bidx");--> statement-breakpoint
CREATE INDEX "contacts_last_name_bidx_idx" ON "contacts" USING btree ("last_name_bidx");--> statement-breakpoint
CREATE INDEX "contacts_phone_bidx_idx" ON "contacts" USING btree ("phone_bidx");--> statement-breakpoint
CREATE INDEX "contacts_email_bidx_idx" ON "contacts" USING btree ("email_bidx");--> statement-breakpoint
CREATE INDEX "deals_workspace_idx" ON "deals" USING btree ("workspace_id");