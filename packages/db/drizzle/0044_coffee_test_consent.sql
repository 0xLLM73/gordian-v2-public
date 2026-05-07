-- Coffee Test: commitment sensitivity enum + priority contacts
-- Consent Persistence: GDPR-compliant consent storage

-- 1. Create commitment_sensitivity enum
CREATE TYPE commitment_sensitivity AS ENUM ('everything', 'specific', 'tasks_only');

-- 2. Add commitment sensitivity + priority contacts to user_calibrations
ALTER TABLE user_calibrations
  ADD COLUMN commitment_sensitivity commitment_sensitivity NOT NULL DEFAULT 'specific',
  ADD COLUMN priority_contact_ids text[] NOT NULL DEFAULT '{}';

-- 3. Add consent columns to user_calibrations
ALTER TABLE user_calibrations
  ADD COLUMN consent_data_processing boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_ai_analysis boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_telegram_access boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_timestamp timestamptz,
  ADD COLUMN consent_version integer NOT NULL DEFAULT 1;
