-- Phase 30: Audit Logging
-- Append-only audit trail for all significant mutations across the system.
-- Three actor types (user, system, ai) tracked uniformly.
-- No decrypted PII stored — resource IDs only.

CREATE TYPE "actor_type" AS ENUM ('user', 'system', 'ai');
CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'delete', 'login', 'sync', 'generate', 'evaluate');
CREATE TYPE "audit_resource_type" AS ENUM ('contact', 'commitment', 'deal', 'introduction', 'goal', 'summary', 'digest', 'brief', 'cadence', 'calendar', 'feature_flag', 'preference', 'decision');

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "actor_type" "actor_type" NOT NULL,
  "actor_id" text NOT NULL,
  "action" "audit_action" NOT NULL,
  "resource_type" "audit_resource_type" NOT NULL,
  "resource_id" uuid,
  "correlation_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_logs_workspace_created_idx" ON "audit_logs" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx" ON "audit_logs" ("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "audit_logs_correlation_idx" ON "audit_logs" ("correlation_id");
