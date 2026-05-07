-- Phase 26: Token Tracking
-- Adds token mention detection and watchlist price tracking tables

-- Watchlist status enum
DO $$ BEGIN
  CREATE TYPE "public"."watchlist_status" AS ENUM('watching', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Token mentions table
CREATE TABLE IF NOT EXISTS "token_mentions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "contact_id" uuid REFERENCES "contacts"("id"),
  "symbol" text NOT NULL,
  "name" text,
  "context" text,
  "confidence" numeric(3, 2),
  "mentioned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Token watchlist table
CREATE TABLE IF NOT EXISTS "token_watchlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "symbol" text NOT NULL,
  "name" text,
  "coingecko_id" text,
  "last_price" numeric(18, 8),
  "price_change_24h" numeric(10, 4),
  "market_cap" numeric(24, 2),
  "mention_count" integer DEFAULT 0 NOT NULL,
  "status" "watchlist_status" DEFAULT 'watching' NOT NULL,
  "price_data" jsonb,
  "last_price_update" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes for token_mentions
CREATE INDEX IF NOT EXISTS "token_mentions_workspace_idx" ON "token_mentions" ("workspace_id");
CREATE INDEX IF NOT EXISTS "token_mentions_symbol_idx" ON "token_mentions" ("workspace_id", "symbol");
CREATE INDEX IF NOT EXISTS "token_mentions_contact_idx" ON "token_mentions" ("workspace_id", "contact_id");

-- Indexes for token_watchlist
CREATE INDEX IF NOT EXISTS "token_watchlist_workspace_idx" ON "token_watchlist" ("workspace_id");
CREATE INDEX IF NOT EXISTS "token_watchlist_symbol_idx" ON "token_watchlist" ("workspace_id", "symbol");
