import type { SealedEnvelope } from '@repo/crypto';
import { computeBlindIndex, decrypt, deriveKeys, encrypt, unwrapWrk } from '@repo/crypto';
/**
 * Encryption Backfill Script
 *
 * Run AFTER deploying the transitionalEncryptedText schema changes.
 * Encrypts existing plaintext data in-place and computes blind indexes.
 *
 * Usage: npx tsx packages/db/src/scripts/encrypt-backfill.ts
 *
 * Requires: DATABASE_URL, AWS KMS access (or DEV_KMS_BYPASS=true + NODE_ENV=development)
 */
import { sql } from 'drizzle-orm';
import { db } from '../client';
import { workspaces } from '../schema/workspaces';

process.env.GORDIAN_ENCRYPTION_BACKFILL = '1';

const BATCH_SIZE = 500;

interface ColumnSpec {
	table: string;
	columns: string[];
	blindIndexes?: Record<string, string>;
}

const SPECS: ColumnSpec[] = [
	{
		table: 'knowledge_nodes',
		columns: ['name', 'display_name', 'description'],
		blindIndexes: { name: 'name_blind_index' },
	},
	{
		table: 'cadences',
		columns: ['title'],
	},
	{
		table: 'cadence_steps',
		columns: ['draft_text', 'prompt'],
	},
	{
		table: 'deals',
		columns: ['title', 'notes'],
		blindIndexes: { title: 'title_blind_index' },
	},
	{
		table: 'deal_participants',
		columns: ['notes'],
	},
	{
		table: 'deal_artifacts',
		columns: ['title', 'url'],
	},
	{
		table: 'deal_ai_runs',
		columns: ['output', 'uncertainty', 'source_manifest'],
	},
	{
		table: 'goals',
		columns: ['title', 'description'],
		blindIndexes: { title: 'title_blind_index' },
	},
	{
		table: 'introductions',
		columns: ['note'],
	},
	{
		table: 'connections',
		columns: ['event', 'context', 'note'],
	},
	{
		table: 'calendar_events',
		columns: ['title', 'description', 'location', 'attendees'],
	},
	{
		table: 'calendar_connections',
		columns: ['email'],
		blindIndexes: { email: 'email_blind_index' },
	},
	{
		table: 'workspace_invites',
		columns: ['email'],
		blindIndexes: { email: 'email_blind_index' },
	},
];

async function getWorkspaceEnvelopes(): Promise<Array<{ id: string; envelope: SealedEnvelope }>> {
	const rows = await db
		.select({
			id: workspaces.id,
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces);

	return rows.map((ws) => {
		const rawCtx = ws.kmsContext;
		const kmsContext: Record<string, string> =
			typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
		return {
			id: ws.id,
			envelope: {
				encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
				kmsContext,
				wrkVersion: ws.wrkVersion,
			},
		};
	});
}

/**
 * SEC-ENC-503: Use actual decrypt attempt instead of base64 heuristic.
 * Base64 heuristic can false-positive on valid-base64 plaintext strings.
 */
function isAlreadyEncrypted(value: string, dek: Buffer): boolean {
	try {
		decrypt(value, dek);
		return true; // Successfully decrypted → already encrypted
	} catch {
		return false; // Decrypt failed → still plaintext
	}
}

async function backfillTable(
	spec: ColumnSpec,
	workspaceId: string,
	dek: Buffer,
	bik: Buffer,
): Promise<number> {
	let offset = 0;
	let total = 0;

	const selectCols = ['id', ...spec.columns];
	if (spec.blindIndexes) {
		selectCols.push(...Object.values(spec.blindIndexes));
	}

	while (true) {
		const rows = (await db.execute(
			sql`/* gordian:encrypted-backfill:v1 */ SELECT ${sql.raw(selectCols.join(', '))} FROM ${sql.raw(spec.table)} WHERE workspace_id = ${workspaceId} ORDER BY id LIMIT ${BATCH_SIZE} OFFSET ${offset}`,
		)) as unknown as Record<string, unknown>[];

		if (!rows || rows.length === 0) break;

		for (const row of rows) {
			// SEC-ENC-500: Build sql template with proper parameter binding
			const updates: ReturnType<typeof sql>[] = [];

			for (const col of spec.columns) {
				const val = row[col] as string | null;
				if (!val || isAlreadyEncrypted(val, dek)) continue;

				// SEC-ENC-002: Never log plaintext values
				const encrypted = encrypt(val, dek);
				updates.push(sql`${sql.raw(col)} = ${encrypted}`);

				if (spec.blindIndexes?.[col]) {
					const bidxCol = spec.blindIndexes[col];
					const bidxVal = computeBlindIndex(val, bik);
					updates.push(sql`${sql.raw(bidxCol)} = ${bidxVal}`);
				}
			}

			if (updates.length > 0) {
				const setClause = sql.join(updates, sql`, `);
				const rowId = row.id as string;
				// SEC-ENC-003: All values bound via Drizzle sql template — no string interpolation
				await db.execute(
					sql`/* gordian:encrypted-backfill:v1 */ UPDATE ${sql.raw(spec.table)} SET ${setClause} WHERE id = ${rowId}`,
				);
				total++;
			}
		}

		offset += BATCH_SIZE;
	}

	return total;
}

async function main() {
	console.log('=== Encryption Backfill ===');
	console.log(`Batch size: ${BATCH_SIZE}`);
	console.log(`Tables: ${SPECS.length}`);

	const workspaceEnvelopes = await getWorkspaceEnvelopes();
	console.log(`Found ${workspaceEnvelopes.length} workspace(s)\n`);

	for (const { id: workspaceId, envelope } of workspaceEnvelopes) {
		console.log(`Processing workspace: ${workspaceId}`);

		const wrk = await unwrapWrk(envelope);
		// Use kmsContext.WorkspaceID (not table id) to match withKeys() key derivation
		const keys = await deriveKeys(wrk, envelope.kmsContext.WorkspaceID, envelope.wrkVersion);

		for (const spec of SPECS) {
			const count = await backfillTable(spec, workspaceId, keys.dek, keys.bik);
			if (count > 0) {
				console.log(`  ${spec.table}: ${count} rows encrypted`);
			}
		}
	}

	console.log('\n=== Backfill complete ===');
	process.exit(0);
}

main().catch((err) => {
	console.error('Backfill failed:', err);
	process.exit(1);
});
