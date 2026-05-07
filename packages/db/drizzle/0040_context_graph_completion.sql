-- Context Graph Completion (Phase 2 Foundation)
-- Adds entityId to user_decisions for entity linking
-- Adds workspace_id + indexes to causal_edges for multi-tenant graph queries
-- Required by: context-graph-completion worker, graphRAG search

-- 1. Add entityId to user_decisions (nullable link to deals, commitments, etc.)
ALTER TABLE "user_decisions" ADD COLUMN IF NOT EXISTS "entity_id" text;

-- 2. Add id + workspace_id to causal_edges (multi-tenant boundary)
ALTER TABLE "causal_edges" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
UPDATE "causal_edges" SET "id" = gen_random_uuid() WHERE "id" IS NULL;
ALTER TABLE "causal_edges" ALTER COLUMN "id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'causal_edges'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE "causal_edges" ADD CONSTRAINT "causal_edges_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

ALTER TABLE "causal_edges" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");

-- Backfill workspace_id from source decision's workspace
UPDATE "causal_edges" ce
SET "workspace_id" = ud."workspace_id"
FROM "user_decisions" ud
WHERE ce."source_id" = ud."id" AND ce."workspace_id" IS NULL;

-- Make workspace_id NOT NULL after backfill
ALTER TABLE "causal_edges" ALTER COLUMN "workspace_id" SET NOT NULL;

-- 3. Add indexes for graph traversal queries
CREATE INDEX IF NOT EXISTS "causal_edges_source_idx" ON "causal_edges" ("source_id");
CREATE INDEX IF NOT EXISTS "causal_edges_target_idx" ON "causal_edges" ("target_id");
CREATE INDEX IF NOT EXISTS "causal_edges_workspace_idx" ON "causal_edges" ("workspace_id");
