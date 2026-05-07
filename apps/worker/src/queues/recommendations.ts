import type { SealedEnvelope } from '@repo/crypto';
import { db, eq, workspaces } from '@repo/db';
import { Queue, Worker } from 'bullmq';
import { computeRecommendations } from '../ai/recommendations';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

export const recommendationsQueue = new Queue('recommendations', {
	connection,
	prefix: '{ai-flow}',
});

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

export const recommendationsWorker = new Worker(
	'recommendations',
	withRLS(async (job) => {
		const { workspaceId } = job.data as { workspaceId: string };

		// Resolve envelope from DB + KMS — the envelope is never in job data (SEC-028)
		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (!envelope) {
			console.error(
				`[recommendations] No workspace envelope found for workspaceId=${workspaceId.slice(0, 8)}, skipping`,
			);
			return;
		}

		console.log(`[recommendations] Computing for workspace=${workspaceId.slice(0, 8)}`);
		await computeRecommendations(workspaceId, envelope);
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 1 },
);

recommendationsWorker.on('completed', (job) => {
	console.log(`[recommendations] Job ${job.id} completed`);
});
recommendationsWorker.on('failed', (job, err) => {
	console.error(`[recommendations] Job ${job?.id} failed:`, err.message);
});

/**
 * Schedule a daily recommendations computation (fires after morning brief).
 * Idempotent — deduplicates by jobId per workspace per day.
 * Envelope is resolved by the worker from DB — not passed in job payload (SEC-028).
 */
export async function scheduleRecommendations(workspaceId: string): Promise<void> {
	await recommendationsQueue.add(
		'compute',
		{ workspaceId },
		{ jobId: `rec-${workspaceId}-${new Date().toISOString().slice(0, 10)}` },
	);
}
