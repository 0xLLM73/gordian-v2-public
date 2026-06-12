import type { SealedEnvelope } from '@repo/crypto';
import { computeBlindIndex, decrypt, deriveRotationKeys, encrypt, unwrapWrk } from '@repo/crypto';
import { db, sql } from '@repo/db';
import { Queue, Worker } from 'bullmq';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

/**
 * Key Rotation Queue (Phase 7, followup5).
 *
 * Handles background re-encryption of workspace data during key rotation.
 * Runs at low priority to avoid disrupting normal operations.
 *
 * Two job types:
 * - 'virtual-rotation': Re-encrypt with new HKDF version (same WRK)
 * - 'root-rotation': Re-encrypt with new WRK (full re-key)
 */

export const rotationQueue = new Queue('rotation', {
	connection,
	prefix: '{ai-flow}',
});

interface VirtualRotationJobData {
	type: 'virtual-rotation';
	workspaceId: string;
	fromVersion: number;
	toVersion: number;
	/** Sealed envelope for current WRK */
	keyEnvelope: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
}

interface RootRotationJobData {
	type: 'root-rotation';
	workspaceId: string;
	/** Old WRK envelope */
	oldKeyEnvelope: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
	/** New WRK envelope */
	newKeyEnvelope: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
}

type RotationJobData = VirtualRotationJobData | RootRotationJobData;

/**
 * Tables with encrypted fields and their column names.
 * SAFETY: These values are interpolated via sql.raw() — must remain compile-time
 * constants. Never populate from database queries or external input.
 */
const ENCRYPTED_TABLES = [
	{
		table: 'contacts',
		idColumn: 'id',
		encryptedColumns: ['first_name', 'last_name', 'phone', 'email', 'notes'],
		blindIndexColumns: {
			first_name: 'first_name_bidx',
			last_name: 'last_name_bidx',
			phone: 'phone_bidx',
			email: 'email_bidx',
		} as Record<string, string>,
	},
	{
		table: 'commitments',
		idColumn: 'id',
		encryptedColumns: ['title', 'quote'],
		blindIndexColumns: {} as Record<string, string>,
	},
] as const;

const BATCH_SIZE = 50;

/**
 * Schedule a virtual rotation re-encryption job.
 */
export async function scheduleVirtualRotation(
	workspaceId: string,
	fromVersion: number,
	toVersion: number,
	keyEnvelope: VirtualRotationJobData['keyEnvelope'],
): Promise<void> {
	await rotationQueue.add(
		'virtual-rotation',
		{
			type: 'virtual-rotation',
			workspaceId,
			fromVersion,
			toVersion,
			keyEnvelope,
		} satisfies VirtualRotationJobData,
		{
			priority: 10, // Low priority — don't block normal operations
			attempts: 3,
			backoff: { type: 'exponential', delay: 30_000 },
		},
	);

	console.log(
		`[rotation] Scheduled virtual rotation for workspace=${workspaceId.slice(0, 8)} v${fromVersion}→v${toVersion}`,
	);
}

/**
 * Schedule a root rotation re-encryption job.
 */
export async function scheduleRootRotation(
	workspaceId: string,
	oldKeyEnvelope: RootRotationJobData['oldKeyEnvelope'],
	newKeyEnvelope: RootRotationJobData['newKeyEnvelope'],
): Promise<void> {
	await rotationQueue.add(
		'root-rotation',
		{
			type: 'root-rotation',
			workspaceId,
			oldKeyEnvelope,
			newKeyEnvelope,
		} satisfies RootRotationJobData,
		{
			priority: 10,
			attempts: 3,
			backoff: { type: 'exponential', delay: 30_000 },
		},
	);

	console.log(`[rotation] Scheduled root rotation for workspace=${workspaceId.slice(0, 8)}`);
}

/**
 * Re-encrypt all encrypted fields in a table for a workspace.
 */
async function reEncryptTable(
	workspaceId: string,
	tableDef: (typeof ENCRYPTED_TABLES)[number],
	oldDek: Buffer,
	newDek: Buffer,
	newBik: Buffer,
): Promise<number> {
	let processed = 0;
	let lastId: string | null = null;

	for (;;) {
		// Keyset pagination for stable batching
		const rows = (await db.execute(
			lastId
				? sql`SELECT ${sql.raw(tableDef.idColumn)}, ${sql.raw(tableDef.encryptedColumns.join(', '))}
					  FROM ${sql.raw(tableDef.table)}
					  WHERE workspace_id = ${workspaceId}
					    AND ${sql.raw(tableDef.idColumn)} > ${lastId}
					  ORDER BY ${sql.raw(tableDef.idColumn)}
					  LIMIT ${BATCH_SIZE}`
				: sql`SELECT ${sql.raw(tableDef.idColumn)}, ${sql.raw(tableDef.encryptedColumns.join(', '))}
					  FROM ${sql.raw(tableDef.table)}
					  WHERE workspace_id = ${workspaceId}
					  ORDER BY ${sql.raw(tableDef.idColumn)}
					  LIMIT ${BATCH_SIZE}`,
		)) as unknown as Array<Record<string, string | null>>;

		if (rows.length === 0) break;

		for (const row of rows) {
			const id = row[tableDef.idColumn];
			if (!id) continue;

			const updates: string[] = [];
			const values: unknown[] = [];

			for (const col of tableDef.encryptedColumns) {
				const value = row[col];
				if (!value) continue;

				try {
					const plaintext = decrypt(value, oldDek);
					const newCiphertext = encrypt(plaintext, newDek);
					updates.push(`${col} = $${values.length + 1}`);
					values.push(newCiphertext);

					// Re-compute blind index if applicable
					const bidxCol = tableDef.blindIndexColumns[col];
					if (bidxCol) {
						const newBidx = computeBlindIndex(plaintext, newBik);
						updates.push(`${bidxCol} = $${values.length + 1}`);
						values.push(newBidx);
					}
				} catch {
					console.warn(
						`[rotation] Failed to re-encrypt ${tableDef.table}.${col} id=${id}, skipping`,
					);
				}
			}

			if (updates.length > 0) {
				const setClause = updates.join(', ');
				await db.execute(
					sql`UPDATE ${sql.raw(tableDef.table)} SET ${sql.raw(setClause)}, updated_at = NOW() WHERE ${sql.raw(tableDef.idColumn)} = ${id} AND workspace_id = ${workspaceId}`,
				);
			}

			lastId = id;
			processed++;
		}

		console.log(`[rotation] Re-encrypted ${processed} rows in ${tableDef.table}`);
	}

	return processed;
}

/**
 * Rotation worker — processes background re-encryption jobs.
 */
export const rotationWorker = new Worker(
	'rotation',
	withRLS(async (job) => {
		const data = job.data as RotationJobData;
		const { workspaceId } = data;

		console.log(`[rotation] Starting ${data.type} for workspace=${workspaceId.slice(0, 8)}`);

		if (data.type === 'virtual-rotation') {
			const envelope: SealedEnvelope = {
				encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
				kmsContext: data.keyEnvelope.kmsContext,
				wrkVersion: data.keyEnvelope.wrkVersion,
			};

			const wrk = await unwrapWrk(envelope);
			const { oldKeys, newKeys } = await deriveRotationKeys(
				wrk,
				workspaceId,
				data.fromVersion,
				data.toVersion,
			);

			let totalProcessed = 0;
			for (const tableDef of ENCRYPTED_TABLES) {
				const count = await reEncryptTable(
					workspaceId,
					tableDef,
					oldKeys.dek,
					newKeys.dek,
					newKeys.bik,
				);
				totalProcessed += count;
			}

			console.log(
				`[rotation] Virtual rotation complete: ${totalProcessed} records re-encrypted (v${data.fromVersion}→v${data.toVersion})`,
			);
			return { type: data.type, totalProcessed };
		}

		if (data.type === 'root-rotation') {
			const oldEnvelope: SealedEnvelope = {
				encryptedWrk: Buffer.from(data.oldKeyEnvelope.encryptedWrk, 'base64'),
				kmsContext: data.oldKeyEnvelope.kmsContext,
				wrkVersion: data.oldKeyEnvelope.wrkVersion,
			};
			const newEnvelope: SealedEnvelope = {
				encryptedWrk: Buffer.from(data.newKeyEnvelope.encryptedWrk, 'base64'),
				kmsContext: data.newKeyEnvelope.kmsContext,
				wrkVersion: data.newKeyEnvelope.wrkVersion,
			};

			const [oldWrk, newWrk] = await Promise.all([unwrapWrk(oldEnvelope), unwrapWrk(newEnvelope)]);

			const { deriveKeys } = await import('@repo/crypto');
			const oldKeys = await deriveKeys(oldWrk, workspaceId, oldEnvelope.wrkVersion);
			const newKeys = await deriveKeys(newWrk, workspaceId, newEnvelope.wrkVersion);

			let totalProcessed = 0;
			for (const tableDef of ENCRYPTED_TABLES) {
				const count = await reEncryptTable(
					workspaceId,
					tableDef,
					oldKeys.dek,
					newKeys.dek,
					newKeys.bik,
				);
				totalProcessed += count;
			}

			// Update workspace record to point to new WRK
			await db.execute(
				sql`UPDATE workspaces
					SET encrypted_wrk = ${data.newKeyEnvelope.encryptedWrk},
						kms_context = ${JSON.stringify(data.newKeyEnvelope.kmsContext)}::jsonb,
						wrk_version = ${data.newKeyEnvelope.wrkVersion}
					WHERE id = ${workspaceId}`,
			);

			console.log(`[rotation] Root rotation complete: ${totalProcessed} records re-encrypted`);
			return { type: data.type, totalProcessed };
		}
	}),
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 1, // Only 1 rotation at a time to limit DB pressure
	},
);

// Event logging
rotationWorker.on('completed', (job) => {
	console.log(`[rotation] Job ${job.id} completed`);
});
rotationWorker.on('failed', (job, err) => {
	console.error(`[rotation] Job ${job?.id} failed:`, err.message);
});
