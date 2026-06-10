ALTER TABLE "cadence_steps"
	ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "processing_lease_expires_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "processing_attempts" integer DEFAULT 0 NOT NULL,
	ADD COLUMN IF NOT EXISTS "last_processing_error" text;

CREATE INDEX IF NOT EXISTS "cadence_steps_processing_lease_idx"
	ON "cadence_steps" ("workspace_id", "status", "processing_lease_expires_at");
