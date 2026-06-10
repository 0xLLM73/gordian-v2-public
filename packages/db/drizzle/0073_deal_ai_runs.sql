CREATE TABLE IF NOT EXISTS "deal_ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"deal_id" uuid NOT NULL REFERENCES "deals"("id") ON DELETE cascade,
	"run_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"model_role" text NOT NULL,
	"model_name" text NOT NULL,
	"local_vendor_mode" text DEFAULT 'local' NOT NULL,
	"output" text NOT NULL,
	"uncertainty" text,
	"source_manifest" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_ai_runs_workspace_deal_idx" ON "deal_ai_runs" ("workspace_id", "deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_ai_runs_status_idx" ON "deal_ai_runs" ("workspace_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_ai_runs_type_idx" ON "deal_ai_runs" ("workspace_id", "run_type");
--> statement-breakpoint
COMMENT ON COLUMN "deal_ai_runs"."output" IS 'Encrypted saved local AI output or deterministic fallback text.';
--> statement-breakpoint
COMMENT ON COLUMN "deal_ai_runs"."uncertainty" IS 'Encrypted uncertainty/refusal explanation.';
--> statement-breakpoint
COMMENT ON COLUMN "deal_ai_runs"."source_manifest" IS 'Encrypted JSON source manifest for saved deal AI output.';
