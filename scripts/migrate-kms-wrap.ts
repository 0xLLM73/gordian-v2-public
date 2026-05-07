/**
 * One-time migration: Re-wrap raw WRKs with real AWS KMS.
 *
 * Before this migration, DEV_KMS_BYPASS=true meant the WRK was stored as raw
 * Base64 bytes in `workspaces.encrypted_wrk`. After this migration, the column
 * holds KMS ciphertext (Base64) that can only be unwrapped with KMS Decrypt.
 *
 * Idempotent: skips workspaces where the value is already KMS ciphertext
 * (Base64 length > 100 chars — raw 32-byte WRK = 44 chars, KMS blob >= 200).
 *
 * Requires real AWS credentials in .env (NOT DEV_KMS_BYPASS).
 *
 * Run from repo root:
 *   DEV_KMS_BYPASS=false pnpm tsx scripts/migrate-kms-wrap.ts
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env.local'), override: false });

// Validate BEFORE loading heavy deps
if (process.env.DEV_KMS_BYPASS === 'true') {
	console.error('ERROR: DEV_KMS_BYPASS is set — this script needs real KMS credentials.');
	console.error('Run with: DEV_KMS_BYPASS=false pnpm tsx scripts/migrate-kms-wrap.ts');
	process.exit(1);
}

const cmkArn = process.env.KMS_CMK_ARN;
if (!cmkArn) {
	console.error('ERROR: KMS_CMK_ARN is not set in environment.');
	process.exit(1);
}

import { EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { db, sql } from '@repo/db';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CMK_ARN = cmkArn;
const kms = new KMSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const RAW_WRK_MAX_LENGTH = 100; // Raw 32-byte key = 44 chars Base64; KMS blob >= 200

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkspaceRow {
	id: string;
	encrypted_wrk: string;
	kms_context: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log('=== KMS WRK Migration ===\n');

	const workspaces = (await db.execute(sql`
		SELECT id, encrypted_wrk, kms_context FROM workspaces
	`)) as unknown as WorkspaceRow[];

	console.log(`Found ${workspaces.length} workspace(s).\n`);

	let migrated = 0;
	let skipped = 0;

	for (const ws of workspaces) {
		const currentLength = ws.encrypted_wrk.length;

		if (currentLength > RAW_WRK_MAX_LENGTH) {
			console.log(`  [SKIP] ${ws.id} — already KMS-wrapped (${currentLength} chars)`);
			skipped++;
			continue;
		}

		console.log(`  [WRAP] ${ws.id} — raw WRK (${currentLength} chars)`);

		// Decode the raw WRK from Base64
		const rawWrk = Buffer.from(ws.encrypted_wrk, 'base64');

		// Encrypt with KMS using the workspace's encryption context
		const encryptionContext = ws.kms_context;
		const result = await kms.send(
			new EncryptCommand({
				KeyId: CMK_ARN,
				Plaintext: rawWrk,
				EncryptionContext: encryptionContext,
			}),
		);

		if (!result.CiphertextBlob) {
			throw new Error(`KMS Encrypt returned empty ciphertext for workspace ${ws.id}`);
		}

		// Store as Base64
		const kmsCiphertext = Buffer.from(result.CiphertextBlob).toString('base64');

		await db.execute(sql`
			UPDATE workspaces
			SET encrypted_wrk = ${kmsCiphertext}
			WHERE id = ${ws.id}
		`);

		console.log(`         → KMS ciphertext (${kmsCiphertext.length} chars)`);
		migrated++;
	}

	console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
	process.exit(0);
}

main().catch((err) => {
	console.error('Migration failed:', err);
	process.exit(1);
});
