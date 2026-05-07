-- Track B: Features 3-7 (dynamic confidence, bandit warm-start, recency, priority ordering)

-- Feature 5: sourceMessageAgeDays on commitments
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "source_message_age_days" integer;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp with time zone;

-- Feature 6: Inline recency columns on contacts
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "last_message_at" timestamp with time zone;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "message_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "ghosting_dismissed_at" timestamp with time zone;

-- User preference fields used by intro detection and ghosting alerts.
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "intro_keywords" text[];
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "ghosting_alert_statuses" text[] NOT NULL DEFAULT ARRAY['cooling','dormant'];
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "ghosting_stale_days" integer NOT NULL DEFAULT 30;
