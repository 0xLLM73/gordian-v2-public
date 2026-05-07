import type { SealedEnvelope } from '@repo/crypto';
import {
	createDigestPlaceholder,
	db,
	eq,
	failDigest,
	finalizeDigest,
	getPreferences,
	workspaces,
} from '@repo/db';
import { Queue, Worker } from 'bullmq';
import { generateDigest } from '../ai/digest';
import { withRLS } from '../middleware/rls';
import { broadcastUpdate } from '../realtime/broadcast';
import { connection } from '../redis';

interface DigestJobData {
	userId: string;
	workspaceId: string;
	period: 'today' | 'yesterday' | '3d' | 'week' | 'custom';
	periodStart?: string; // ISO8601
	periodEnd?: string; // ISO8601
}

/** Resolve the workspace encryption envelope from DB — never from job payload (SEC-028) */
async function getWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	if (result.length === 0) return null;
	const ws = result[0];
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};
}

export const digestQueue = new Queue<DigestJobData>('digests', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 10000 },
		removeOnComplete: { count: 500 },
		removeOnFail: { count: 1000 },
	},
});

export const digestWorker = new Worker<DigestJobData>(
	'digests',
	withRLS(async (job) => {
		const { userId, workspaceId, period } = job.data;
		console.log(`[digest] Generating ${period} digest for user=${userId.slice(0, 8)}`);

		// Calculate time window
		const now = new Date();
		const periodEnd = job.data.periodEnd ? new Date(job.data.periodEnd) : now;
		let periodStart: Date;

		if (job.data.periodStart) {
			periodStart = new Date(job.data.periodStart);
		} else {
			switch (period) {
				case 'today': {
					const d = new Date(now);
					d.setHours(0, 0, 0, 0);
					periodStart = d;
					break;
				}
				case 'yesterday': {
					const d = new Date(now);
					d.setDate(d.getDate() - 1);
					d.setHours(0, 0, 0, 0);
					periodStart = d;
					break;
				}
				case '3d': {
					const d = new Date(now);
					d.setDate(d.getDate() - 3);
					periodStart = d;
					break;
				}
				case 'week': {
					const d = new Date(now);
					d.setDate(d.getDate() - 7);
					periodStart = d;
					break;
				}
				default: {
					const d = new Date(now);
					d.setHours(0, 0, 0, 0);
					periodStart = d;
				}
			}
		}

		// Resolve envelope from DB + KMS — the envelope is never in job data (SEC-028)
		const envelope = await getWorkspaceEnvelope(workspaceId);

		if (!envelope) {
			console.error(
				`[digest] No workspace envelope found for workspaceId=${workspaceId.slice(0, 8)}, skipping`,
			);
			return;
		}

		// Create placeholder
		const placeholder = await createDigestPlaceholder(workspaceId, {
			userId,
			period,
			periodStart,
			periodEnd,
		});

		if (!placeholder) {
			console.error(`[digest] Failed to create placeholder for user=${userId.slice(0, 8)}`);
			return;
		}

		// Read user preferences for digest focus
		const prefs = await getPreferences(workspaceId, userId);

		// Derive workspace salt from workspaceId (no dedicated salt column in schema)
		const salt = Buffer.from(workspaceId);

		try {
			// Generate digest
			const result = await generateDigest(
				{
					userId,
					workspaceId,
					periodStart,
					periodEnd,
					digestFocus: prefs.digestFocus,
					workspaceSalt: salt,
				},
				envelope,
			);

			// Finalize in DB
			await finalizeDigest(workspaceId, placeholder.id, result, envelope);

			// Broadcast to web dashboard
			await broadcastUpdate(workspaceId, 'digest-ready', {
				digestId: placeholder.id,
				period,
				generatedAt: new Date().toISOString(),
			});

			console.log(`[digest] Digest ${placeholder.id} ready for user=${userId.slice(0, 8)}`);
		} catch (err) {
			console.error(
				`[digest] Generation failed for user=${userId.slice(0, 8)}:`,
				(err as Error).message,
			);
			await failDigest(workspaceId, placeholder.id);
			throw err;
		}
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 2 },
);

digestWorker.on('completed', (job) => {
	console.log(`[digest] Job ${job.id} completed`);
});
digestWorker.on('failed', (job, err) => {
	console.error(`[digest] Job ${job?.id} failed:`, err.message);
});
