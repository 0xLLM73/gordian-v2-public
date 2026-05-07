-- Sprint 4 Task C: Collapse intro_status enum from 7 values to 3
-- Mapping: detected→triage, confirmed/accepted/active→active, completed/scored→archive, dismissed→archive
-- Also adds auto_confirmed boolean column

-- Step 1: Create new enum type
CREATE TYPE "public"."intro_status_new" AS ENUM('triage', 'active', 'archive');

-- Step 2: Migrate column to new enum with data mapping
ALTER TABLE introductions
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE introductions
  ALTER COLUMN status TYPE "public"."intro_status_new"
  USING CASE status::text
    WHEN 'detected' THEN 'triage'::intro_status_new
    WHEN 'confirmed' THEN 'active'::intro_status_new
    WHEN 'accepted' THEN 'active'::intro_status_new
    WHEN 'active' THEN 'active'::intro_status_new
    WHEN 'completed' THEN 'archive'::intro_status_new
    WHEN 'scored' THEN 'archive'::intro_status_new
    WHEN 'dismissed' THEN 'archive'::intro_status_new
  END;

ALTER TABLE introductions
  ALTER COLUMN status SET DEFAULT 'triage'::intro_status_new;

-- Step 3: Drop old enum, rename new
DROP TYPE "public"."intro_status";
ALTER TYPE "public"."intro_status_new" RENAME TO "intro_status";

-- Step 4: Add auto_confirmed column
ALTER TABLE introductions ADD COLUMN IF NOT EXISTS auto_confirmed boolean NOT NULL DEFAULT false;
