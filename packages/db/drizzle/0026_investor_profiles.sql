-- Phase 34: Investor Pattern Detection
-- Computed intelligence profile per investor contact, derived from deal history.
-- No LLM: all fields computed by pure functions in apps/worker/src/ai/investor-patterns.ts
--
-- PII guard: sector_focus, token_interests, preferred_role store category labels only.
-- Contact names, handles, or identifiers must NOT appear in these columns.

CREATE TYPE "activity_trend" AS ENUM (
  'heating_up',
  'steady',
  'cooling_down'
);

CREATE TABLE IF NOT EXISTS "investor_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "deal_count" integer NOT NULL DEFAULT 0,
  -- Ratio of won deals to total completed deals (0.0–1.0)
  "win_rate" real NOT NULL DEFAULT 0,
  "avg_cycle_days" integer NOT NULL DEFAULT 0,
  -- e.g. 'lead', 'co_investor' — category only, no PII
  "preferred_role" text,
  -- e.g. ['DeFi', 'Infrastructure'] — sector labels, no PII
  "sector_focus" text[],
  -- USD cents
  "ticket_min" bigint,
  "ticket_max" bigint,
  -- e.g. ['ETH', 'SOL'] — token symbols only, no PII
  "token_interests" text[],
  "activity_trend" "activity_trend" NOT NULL DEFAULT 'steady',
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- One profile per investor per workspace
CREATE UNIQUE INDEX IF NOT EXISTS "investor_profiles_workspace_contact_uniq"
  ON "investor_profiles" ("workspace_id", "contact_id");

CREATE INDEX IF NOT EXISTS "investor_profiles_workspace_idx"
  ON "investor_profiles" ("workspace_id");

-- Leaderboard query: top investors by win rate in a workspace
CREATE INDEX IF NOT EXISTS "investor_profiles_win_rate_idx"
  ON "investor_profiles" ("workspace_id", "win_rate");
