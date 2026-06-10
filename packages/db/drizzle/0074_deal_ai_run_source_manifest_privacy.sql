-- Deal AI source manifests can include decrypted source labels and snippets.
-- Keep the physical column as text because encryptedJson stores ciphertext in text.
-- Run packages/db/src/scripts/encrypt-backfill.ts after this migration to encrypt
-- existing JSONB/plaintext source_manifest values in-place.

ALTER TABLE "deal_ai_runs"
	ALTER COLUMN "source_manifest" DROP DEFAULT;

ALTER TABLE "deal_ai_runs"
	ALTER COLUMN "source_manifest" TYPE text
	USING COALESCE("source_manifest"::text, '[]');

UPDATE "deal_ai_runs"
SET "source_manifest" = '[]'
WHERE "source_manifest" IS NULL;

ALTER TABLE "deal_ai_runs"
	ALTER COLUMN "source_manifest" SET NOT NULL;

COMMENT ON COLUMN "deal_ai_runs"."source_manifest" IS
	'Encrypted JSON source manifest for saved deal AI output.';
