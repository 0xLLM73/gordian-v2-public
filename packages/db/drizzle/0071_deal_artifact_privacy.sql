-- Deal Artifact Privacy: title and URL/reference are sensitive deal data.
-- The physical columns remain text because encryptedText stores ciphertext in text columns.
-- Run packages/db/src/scripts/encrypt-backfill.ts after this migration to encrypt legacy plaintext rows.

ALTER TABLE deal_artifacts
  ALTER COLUMN data_classification SET DEFAULT 'deal_artifact_sensitive';

UPDATE deal_artifacts
SET data_classification = 'deal_artifact_sensitive'
WHERE data_classification IS NULL;

COMMENT ON COLUMN deal_artifacts.title IS
  'Encrypted in the app layer with the workspace DEK. Do not query or log as plaintext.';

COMMENT ON COLUMN deal_artifacts.url IS
  'Encrypted in the app layer with the workspace DEK. Stores URL or file reference metadata.';
