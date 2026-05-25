-- Add durable archive resolution for introductions.
-- The status enum intentionally stays collapsed to triage/active/archive; this
-- column records whether an archived intro was completed or dismissed.

DO $$
BEGIN
  CREATE TYPE "public"."intro_resolution" AS ENUM ('completed', 'dismissed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE introductions
  ADD COLUMN IF NOT EXISTS resolution "public"."intro_resolution";

UPDATE introductions
SET resolution = CASE
  WHEN status_history @> '[{"status":"dismissed"}]'::jsonb THEN 'dismissed'::intro_resolution
  WHEN status_history @> '[{"status":"completed"}]'::jsonb THEN 'completed'::intro_resolution
  WHEN status_history @> '[{"status":"scored"}]'::jsonb THEN 'completed'::intro_resolution
  ELSE resolution
END
WHERE status = 'archive'
  AND resolution IS NULL
  AND (
    status_history @> '[{"status":"dismissed"}]'::jsonb
    OR status_history @> '[{"status":"completed"}]'::jsonb
    OR status_history @> '[{"status":"scored"}]'::jsonb
  );

DO $$
BEGIN
  ALTER TABLE introductions
    ADD CONSTRAINT introductions_distinct_contacts_check
    CHECK (
      introducer_contact_id <> introduced_contact_id_1
      AND introducer_contact_id <> introduced_contact_id_2
      AND introduced_contact_id_1 <> introduced_contact_id_2
    )
    NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS introductions_workspace_resolution_idx
  ON introductions (workspace_id, resolution, updated_at);
