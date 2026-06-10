CREATE TABLE IF NOT EXISTS "follow_up_plan_worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_error_summary" text,
	"processed_steps" integer DEFAULT 0 NOT NULL,
	"failed_steps" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "follow_up_plan_worker_heartbeats_status_idx"
	ON "follow_up_plan_worker_heartbeats" ("status");

CREATE INDEX IF NOT EXISTS "follow_up_plan_worker_heartbeats_last_seen_idx"
	ON "follow_up_plan_worker_heartbeats" ("last_seen_at");
