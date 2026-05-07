/**
 * One-time migration: encrypt plaintext Telegram sessions in accounts.access_token.
 *
 * Safe to run multiple times (idempotent). Already-encrypted values are skipped.
 *
 * Run order:
 *   1. Deploy this script to worker
 *   2. Run: npx tsx scripts/migrate-encrypt-accesstoken.ts
 *   3. Deploy schema change (encryptedSessionText column) + app code
 *
 * Alternatively, if the schema change is already deployed (custom-types fromDriver()
 * has the plaintext fallback), this script can run after deploy to clean up.
 */

import { encrypt, getCurrentKeys, withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { db, eq, sql, workspaceMembers, workspaces } from '@repo/db';

/**
 * AES-256-GCM ciphertext produced by @repo/crypto is base64-encoded:
 *   12-byte IV + ciphertext + 16-byte auth tag → at least 29 bytes → base64 ≥ 40 chars.
 * Telegram session strings are alphanumeric + punctuation but not base64 binary blobs.
 */
function isAlreadyEncrypted(value: string): boolean {
	return value.length >= 40 && /^[A-Za-z0-9+/=]+$/.test(value);
}

async function getEnvelopeForUser(userId: string): Promise<SealedEnvelope | null> {
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaceMembers)
		.innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
		.where(eq(workspaceMembers.userId, userId))
		.limit(1);

	if (result.length === 0) return null;
	const ws = result[0];
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext: ws.kmsContext as Record<string, string>,
		wrkVersion: ws.wrkVersion,
	};
}

async function main() {
	console.log('[migrate-encrypt-accesstoken] Starting...');

	// Raw SQL: avoid triggering encryptedSessionText fromDriver() on plaintext values
	const rows = await db.execute<{ id: string; user_id: string; access_token: string }>(
		sql`SELECT id, user_id, access_token FROM accounts WHERE provider_id = 'telegram' AND access_token IS NOT NULL`,
	);

	const allRows = rows.rows;
	console.log(`[migrate-encrypt-accesstoken] Found ${allRows.length} Telegram accounts to check`);

	let skipped = 0;
	let encrypted = 0;
	let failed = 0;

	for (const row of allRows) {
		const { id: accountId, user_id: userId, access_token: accessToken } = row;

		if (isAlreadyEncrypted(accessToken)) {
			skipped++;
			continue;
		}

		const envelope = await getEnvelopeForUser(userId);
		if (!envelope) {
			console.warn(`[migrate] No workspace for user=${userId.slice(0, 8)} — skipping`);
			failed++;
			continue;
		}

		try {
			// withKeys() derives TSK from the envelope and loads it into AsyncLocalStorage.
			// Inside the callback, getCurrentKeys().tsk is the correct encryption key.
			const ciphertext = await withKeys(envelope, async () => {
				const keys = getCurrentKeys();
				return encrypt(accessToken, keys.tsk);
			});

			// Raw SQL update — bypasses Drizzle encryptedSessionText toDriver() to avoid
			// double-encryption if the schema change is already deployed.
			await db.execute(
				sql`UPDATE accounts SET access_token = ${ciphertext}, updated_at = now() WHERE id = ${accountId}`,
			);

			encrypted++;
			console.log(`[migrate] Encrypted account=${accountId.slice(0, 8)}`);
		} catch (err) {
			console.error(
				`[migrate] Failed for account=${accountId.slice(0, 8)}:`,
				(err as Error).message,
			);
			failed++;
		}
	}

	console.log(
		`[migrate-encrypt-accesstoken] Done. encrypted=${encrypted} skipped=${skipped} failed=${failed}`,
	);

	if (failed > 0) {
		console.warn(
			`[migrate-encrypt-accesstoken] ${failed} accounts could not be encrypted (no workspace)`,
		);
	}

	process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('[migrate-encrypt-accesstoken] Fatal error:', err);
	process.exit(1);
});
