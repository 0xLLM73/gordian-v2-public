CREATE TABLE IF NOT EXISTS "deal_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"deal_id" uuid NOT NULL REFERENCES "deals"("id") ON DELETE cascade,
	"previous_stage" "deal_stage",
	"next_stage" "deal_stage" NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"note" text,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_stage_events_workspace_deal_idx" ON "deal_stage_events" ("workspace_id", "deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_stage_events_occurred_idx" ON "deal_stage_events" ("workspace_id", "occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_stage_events_idempotency_uniq" ON "deal_stage_events" ("workspace_id", "deal_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"deal_id" uuid NOT NULL REFERENCES "deals"("id") ON DELETE cascade,
	"decision_type" text DEFAULT 'manual' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"label" text NOT NULL,
	"rationale" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_decisions_workspace_deal_idx" ON "deal_decisions" ("workspace_id", "deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_decisions_status_idx" ON "deal_decisions" ("workspace_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"deal_id" uuid NOT NULL REFERENCES "deals"("id") ON DELETE cascade,
	"decision_id" uuid REFERENCES "deal_decisions"("id") ON DELETE set null,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"label" text,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_evidence_links_workspace_deal_idx" ON "deal_evidence_links" ("workspace_id", "deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_evidence_links_decision_idx" ON "deal_evidence_links" ("workspace_id", "decision_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_evidence_links_source_idx" ON "deal_evidence_links" ("workspace_id", "source_type", "source_id");
--> statement-breakpoint
COMMENT ON COLUMN "deal_stage_events"."note" IS 'Encrypted stage-change note.';
--> statement-breakpoint
COMMENT ON COLUMN "deal_decisions"."label" IS 'Encrypted deal decision label.';
--> statement-breakpoint
COMMENT ON COLUMN "deal_decisions"."rationale" IS 'Encrypted deal decision rationale.';
--> statement-breakpoint
COMMENT ON COLUMN "deal_evidence_links"."label" IS 'Encrypted evidence display label.';
--> statement-breakpoint
COMMENT ON COLUMN "deal_evidence_links"."summary" IS 'Encrypted evidence summary.';
