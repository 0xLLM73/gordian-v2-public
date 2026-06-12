/**
 * Data Migration: Encrypt plaintext PII columns (Stage 2 — SEC-004/005/012/014)
 *
 * Encrypts existing plaintext rows for the 8 columns added to encryptedText
 * in the Stage 2 schema migration. Safe to run multiple times (idempotent).
 *
 * Idempotency: Tries to decrypt each value with the DEK.
 * If decrypt succeeds → already encrypted, skip.
 * If decrypt throws (GCM auth tag mismatch) → plaintext, encrypt and update.
 *
 * Run from worker machine (KMS access required):
 *   pnpm --filter worker tsx src/scripts/migrate-encrypt-pii.ts
 */

import type { SealedEnvelope } from '@repo/crypto';
import { decrypt, deriveKeys, encrypt, unwrapWrk } from '@repo/crypto';
import { db, sql } from '@repo/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if `value` appears to be already AES-256-GCM encrypted by our system. */
function isAlreadyEncrypted(value: string, dek: Buffer): boolean {
	try {
		decrypt(value, dek);
		return true;
	} catch {
		return false;
	}
}

interface WorkspaceRow {
	id: string;
	encryptedWrk: string;
	kmsContext: Record<string, string>;
	wrkVersion: number;
}

async function getWorkspaces(): Promise<WorkspaceRow[]> {
	const result = await db.execute(sql`
		SELECT id,
		       encrypted_wrk AS "encryptedWrk",
		       kms_context AS "kmsContext",
		       wrk_version AS "wrkVersion"
		FROM workspaces
	`);
	return result as unknown as WorkspaceRow[];
}

async function getDekForWorkspace(ws: WorkspaceRow): Promise<Buffer> {
	const envelope: SealedEnvelope = {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext: ws.kmsContext,
		wrkVersion: ws.wrkVersion,
	};
	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, ws.id, ws.wrkVersion);
	return keys.dek;
}

// ---------------------------------------------------------------------------
// Per-table migration functions (all parameterized, no sql.raw)
// ---------------------------------------------------------------------------

async function migrateColumn(
	workspaceId: string,
	dek: Buffer,
	table: string,
	column: string,
): Promise<number> {
	const rows = (await db.execute(sql`
		SELECT id, ${sql.raw(column)} AS value
		FROM ${sql.raw(table)}
		WHERE workspace_id = ${workspaceId}::uuid
		  AND ${sql.raw(column)} IS NOT NULL
	`)) as unknown as Array<{ id: string; value: string }>;

	let count = 0;
	for (const row of rows) {
		if (!isAlreadyEncrypted(row.value, dek)) {
			const ciphertext = encrypt(row.value, dek);
			await db.execute(sql`
				UPDATE ${sql.raw(table)}
				SET ${sql.raw(column)} = ${ciphertext}
				WHERE id = ${row.id}::uuid
			`);
			count++;
		}
	}
	return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log('[migrate-encrypt-pii] Starting Stage 2 PII encryption migration');

	const workspaces = await getWorkspaces();
	console.log(`[migrate-encrypt-pii] Found ${workspaces.length} workspaces`);

	// Columns to encrypt: (table, column)
	// SAFETY: These values are interpolated via sql.raw() — must remain compile-time
	// constants. Never populate from database queries or external input.
	const targets: Array<[string, string]> = [
		['memories', 'content'],
		['user_decisions', 'raw_content'],
		['commitments', 'title'],
		['commitments', 'quote'],
		['chats', 'title'],
		['chats', 'username'],
		['deals', 'notes'],
		['contact_relationships', 'notes'],
	];

	let totalUpdated = 0;

	for (const ws of workspaces) {
		console.log(`[migrate-encrypt-pii] Processing workspace ${ws.id}`);

		let dek: Buffer;
		try {
			dek = await getDekForWorkspace(ws);
		} catch (err) {
			console.error(`[migrate-encrypt-pii] Failed to derive DEK for workspace ${ws.id}:`, err);
			continue;
		}

		for (const [table, column] of targets) {
			try {
				const n = await migrateColumn(ws.id, dek, table, column);
				if (n > 0) {
					console.log(`  [${ws.id}] ${table}.${column}: encrypted ${n} rows`);
					totalUpdated += n;
				}
			} catch (err) {
				console.error(`  [${ws.id}] ${table}.${column}: ERROR`, err);
			}
		}
	}

	console.log(
		`[migrate-encrypt-pii] Complete. Total values encrypted: ${totalUpdated}. Safe to re-run (idempotent).`,
	);
	process.exit(0);
}

main().catch((err) => {
	console.error('[migrate-encrypt-pii] Fatal error:', err);
	process.exit(1);
});
