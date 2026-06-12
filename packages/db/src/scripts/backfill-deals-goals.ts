/**
 * BACKFILL-001: Encrypt remaining plaintext rows in deals + goals tables.
 *
 * Root cause: encrypt-backfill.ts SPECS was missing deals.notes, and some rows
 * were inserted as plaintext after the initial backfill ran.
 *
 * The schema now uses strict encryptedText (not transitionalEncryptedText),
 * so decrypt() throws on plaintext — crashing dashboard/deals/goals pages.
 *
 * Usage:
 *   DATABASE_URL="$DIRECT_URL" npx tsx packages/db/src/scripts/backfill-deals-goals.ts
 *
 * Requires: DATABASE_URL (direct, not pooler), AWS KMS access
 *   (or DEV_KMS_BYPASS=true + NODE_ENV=development)
 */

import type { SealedEnvelope } from '@repo/crypto';
import { computeBlindIndex, decrypt, deriveKeys, encrypt, unwrapWrk } from '@repo/crypto';
import { sql } from 'drizzle-orm';
import { db } from '../client';
import { workspaces } from '../schema/workspaces';

const BATCH_SIZE = 500;

interface ColumnSpec {
	table: string;
	columns: string[];
	blindIndexes?: Record<string, string>;
}

const SPECS: ColumnSpec[] = [
	{
		table: 'deals',
		columns: ['title', 'notes'],
		blindIndexes: { title: 'title_blind_index' },
	},
	{
		table: 'goals',
		columns: ['title', 'description'],
		blindIndexes: { title: 'title_blind_index' },
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
 */
function isAlreadyEncrypted(value: string, dek: Buffer): boolean {
	try {
		decrypt(value, dek);
		return true;
	} catch {
		return false;
	}
}

interface BackfillStats {
	table: string;
	encrypted: number;
	skipped: number;
	nulls: number;
}

async function backfillTable(
	spec: ColumnSpec,
	workspaceId: string,
	dek: Buffer,
	bik: Buffer,
): Promise<BackfillStats> {
	let offset = 0;
	const stats: BackfillStats = { table: spec.table, encrypted: 0, skipped: 0, nulls: 0 };

	const selectCols = ['id', ...spec.columns];
	if (spec.blindIndexes) {
		selectCols.push(...Object.values(spec.blindIndexes));
	}

	while (true) {
		const rows = (await db.execute(
			sql`SELECT ${sql.raw(selectCols.join(', '))} FROM ${sql.raw(spec.table)} WHERE workspace_id = ${workspaceId} ORDER BY id LIMIT ${BATCH_SIZE} OFFSET ${offset}`,
		)) as unknown as Record<string, unknown>[];

		if (!rows || rows.length === 0) break;

		for (const row of rows) {
			const updates: ReturnType<typeof sql>[] = [];

			for (const col of spec.columns) {
				const val = row[col] as string | null;
				if (!val) {
					stats.nulls++;
					continue;
				}
				if (isAlreadyEncrypted(val, dek)) {
					stats.skipped++;
					continue;
				}

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
				await db.execute(sql`UPDATE ${sql.raw(spec.table)} SET ${setClause} WHERE id = ${rowId}`);
				stats.encrypted++;
			}
		}

		offset += BATCH_SIZE;
	}

	return stats;
}

async function main() {
	console.log('=== BACKFILL-001: Deals + Goals Encryption ===');
	console.log(`Tables: ${SPECS.map((s) => s.table).join(', ')}`);
	console.log(`Batch size: ${BATCH_SIZE}\n`);

	const workspaceEnvelopes = await getWorkspaceEnvelopes();
	console.log(`Found ${workspaceEnvelopes.length} workspace(s)\n`);

	const allStats: BackfillStats[] = [];

	for (const { id: workspaceId, envelope } of workspaceEnvelopes) {
		console.log(`--- Workspace: ${workspaceId} ---`);

		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);

		for (const spec of SPECS) {
			const stats = await backfillTable(spec, workspaceId, keys.dek, keys.bik);
			allStats.push(stats);
			console.log(
				`  ${stats.table}: ${stats.encrypted} encrypted, ${stats.skipped} already encrypted, ${stats.nulls} nulls`,
			);
		}
	}

	console.log('\n=== Summary ===');
	const totalEncrypted = allStats.reduce((sum, s) => sum + s.encrypted, 0);
	const totalSkipped = allStats.reduce((sum, s) => sum + s.skipped, 0);
	console.log(`Total rows encrypted: ${totalEncrypted}`);
	console.log(`Total rows already encrypted (skipped): ${totalSkipped}`);

	if (totalEncrypted === 0) {
		console.log('\nNo plaintext rows found — all data already encrypted.');
	} else {
		console.log(`\n${totalEncrypted} rows encrypted successfully.`);
	}

	console.log('\n=== Verification queries ===');
	for (const spec of SPECS) {
		for (const col of spec.columns) {
			const countResult = (await db.execute(
				sql`SELECT count(*) as cnt FROM ${sql.raw(spec.table)} WHERE ${sql.raw(col)} IS NOT NULL`,
			)) as unknown as Array<{ cnt: number }>;
			console.log(`  ${spec.table}.${col}: ${countResult[0]?.cnt ?? 0} non-null rows`);
		}
	}

	console.log('\n=== Backfill complete ===');
	process.exit(0);
}

main().catch((err) => {
	console.error('Backfill failed:', err);
	process.exit(1);
});
