/**
 * FIX-KEY-001: Re-encrypt data that was encrypted with wrong key derivation salt.
 *
 * Root cause: encrypt-backfill.ts used `deriveKeys(wrk, workspaceId, ...)` where
 * workspaceId is the table's `id` column. But withKeys() in the web app uses
 * `envelope.kmsContext.WorkspaceID` — a different UUID. Data encrypted with the
 * wrong salt cannot be decrypted by the app.
 *
 * Fix: For each encrypted value, decrypt with the WRONG key (table id), then
 * re-encrypt with the CORRECT key (kmsContext.WorkspaceID).
 *
 * Usage:
 *   DATABASE_URL="$DIRECT_URL" npx tsx packages/db/src/scripts/fix-key-derivation.ts
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
	{
		table: 'outcomes',
		columns: ['notes'],
	},
	{
		table: 'contacts',
		columns: ['first_name', 'last_name', 'phone', 'email'],
		blindIndexes: {
			first_name: 'first_name_blind_index',
			last_name: 'last_name_blind_index',
			phone: 'phone_blind_index',
			email: 'email_blind_index',
		},
	},
	{
		table: 'commitments',
		columns: ['title', 'quote', 'extraction_context', 'fulfillment_evidence'],
	},
	{
		table: 'messages',
		columns: ['text'],
	},
];

async function getWorkspaceEnvelopes(): Promise<
	Array<{ tableId: string; kmsWorkspaceId: string; envelope: SealedEnvelope }>
> {
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
			tableId: ws.id,
			kmsWorkspaceId: kmsContext.WorkspaceID,
			envelope: {
				encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
				kmsContext,
				wrkVersion: ws.wrkVersion,
			},
		};
	});
}

interface ReKeyStats {
	table: string;
	reKeyed: number;
	skipped: number;
	nulls: number;
	alreadyCorrect: number;
}

async function reKeyTable(
	spec: ColumnSpec,
	workspaceId: string,
	wrongDek: Buffer,
	correctDek: Buffer,
	correctBik: Buffer,
): Promise<ReKeyStats> {
	let offset = 0;
	const stats: ReKeyStats = {
		table: spec.table,
		reKeyed: 0,
		skipped: 0,
		nulls: 0,
		alreadyCorrect: 0,
	};

	const selectCols = ['id', ...spec.columns];

	while (true) {
		const rows = (await db.execute(
			sql`SELECT ${sql.raw(selectCols.join(', '))} FROM ${sql.raw(spec.table)} WHERE workspace_id = ${workspaceId} ORDER BY id LIMIT ${BATCH_SIZE} OFFSET ${offset}`,
		)) as unknown as Record<string, unknown>[];

		if (!rows || rows.length === 0) break;

		for (const row of rows) {
			const updates: ReturnType<typeof sql>[] = [];
			let rowReKeyed = false;

			for (const col of spec.columns) {
				const val = row[col] as string | null;
				if (!val) {
					stats.nulls++;
					continue;
				}

				// Try decrypt with CORRECT key first — if it works, data is already good
				try {
					decrypt(val, correctDek);
					stats.alreadyCorrect++;
					continue;
				} catch {
					// Can't decrypt with correct key — try wrong key
				}

				// Try decrypt with WRONG key (table id based)
				let plaintext: string;
				try {
					plaintext = decrypt(val, wrongDek);
				} catch {
					// Can't decrypt with either key — skip (might be plaintext or corrupted)
					console.warn(
						`  WARNING: ${spec.table}.${col} row ${row.id} — can't decrypt with either key, skipping`,
					);
					stats.skipped++;
					continue;
				}

				// Re-encrypt with CORRECT key
				const reEncrypted = encrypt(plaintext, correctDek);
				updates.push(sql`${sql.raw(col)} = ${reEncrypted}`);

				// Recompute blind index with correct BIK
				if (spec.blindIndexes?.[col]) {
					const bidxCol = spec.blindIndexes[col];
					const bidxVal = computeBlindIndex(plaintext, correctBik);
					updates.push(sql`${sql.raw(bidxCol)} = ${bidxVal}`);
				}

				rowReKeyed = true;
			}

			if (updates.length > 0) {
				const setClause = sql.join(updates, sql`, `);
				const rowId = row.id as string;
				await db.execute(sql`UPDATE ${sql.raw(spec.table)} SET ${setClause} WHERE id = ${rowId}`);
			}
			if (rowReKeyed) stats.reKeyed++;
		}

		offset += BATCH_SIZE;
	}

	return stats;
}

async function main() {
	console.log('=== FIX-KEY-001: Re-encrypt data with correct key derivation ===\n');

	const workspaceEnvelopes = await getWorkspaceEnvelopes();
	console.log(`Found ${workspaceEnvelopes.length} workspace(s)\n`);

	for (const { tableId, kmsWorkspaceId, envelope } of workspaceEnvelopes) {
		console.log(`--- Workspace: ${tableId} ---`);
		console.log(`  Table ID:         ${tableId}`);
		console.log(`  KMS WorkspaceID:  ${kmsWorkspaceId}`);

		if (tableId === kmsWorkspaceId) {
			console.log('  IDs match — no re-keying needed for this workspace\n');
			continue;
		}

		console.log('  IDs DIFFER — re-keying required\n');

		const wrk = await unwrapWrk(envelope);
		const wrongKeys = await deriveKeys(wrk, tableId, envelope.wrkVersion);
		const correctKeys = await deriveKeys(wrk, kmsWorkspaceId, envelope.wrkVersion);

		const allStats: ReKeyStats[] = [];

		for (const spec of SPECS) {
			const stats = await reKeyTable(
				spec,
				tableId,
				wrongKeys.dek,
				correctKeys.dek,
				correctKeys.bik,
			);
			allStats.push(stats);
			if (stats.reKeyed > 0 || stats.alreadyCorrect > 0) {
				console.log(
					`  ${stats.table}: ${stats.reKeyed} re-keyed, ${stats.alreadyCorrect} already correct, ${stats.nulls} nulls, ${stats.skipped} skipped`,
				);
			}
		}

		const totalReKeyed = allStats.reduce((sum, s) => sum + s.reKeyed, 0);
		const totalCorrect = allStats.reduce((sum, s) => sum + s.alreadyCorrect, 0);
		console.log(`\n  Total: ${totalReKeyed} rows re-keyed, ${totalCorrect} already correct\n`);
	}

	console.log('=== Fix complete ===');
	process.exit(0);
}

main().catch((err) => {
	console.error('Fix failed:', err);
	process.exit(1);
});
