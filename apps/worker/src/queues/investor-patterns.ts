import type { SealedEnvelope } from '@repo/crypto';
import { Queue, Worker } from 'bullmq';
import { computeInvestorProfile } from '../ai/investor-patterns';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

export const investorPatternsQueue = new Queue('investor-patterns', {
	connection,
	prefix: '{ai-flow}',
});

interface InvestorPatternsJobData {
	workspaceId: string;
	contactId: string;
	envelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
}

/**
 * Investor patterns worker — processes deal-closed events.
 * Triggered when a deal transitions to 'won' or 'lost'.
 * Job payload: { workspaceId, contactId, envelope? }
 */
export const investorPatternsWorker = new Worker(
	'investor-patterns',
	withRLS<InvestorPatternsJobData>(async (job) => {
		const { workspaceId, contactId, envelope: envelopePayload } = job.data;

		if (!envelopePayload) {
			console.log(
				`[investor-patterns] No envelope for workspace=${workspaceId.slice(0, 8)}, skipping`,
			);
			return;
		}

		const envelope: SealedEnvelope = {
			encryptedWrk: Buffer.from(envelopePayload.encryptedWrk, 'base64'),
			kmsContext: envelopePayload.kmsContext,
			wrkVersion: envelopePayload.wrkVersion,
		};

		await computeInvestorProfile(workspaceId, contactId, envelope);
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 2 },
);

investorPatternsWorker.on('completed', (job) => {
	console.log(`[investor-patterns] Job ${job.id} completed`);
});
investorPatternsWorker.on('failed', (job, err) => {
	console.error(`[investor-patterns] Job ${job?.id} failed:`, err.message);
});

/**
 * Enqueue an investor profile recomputation after a deal closes.
 * Called when a deal transitions to 'won' or 'lost'.
 * Idempotent: deduplicated by contactId + date to prevent double-computation.
 */
export async function enqueueInvestorProfileUpdate(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
): Promise<void> {
	const today = new Date().toISOString().slice(0, 10);
	await investorPatternsQueue.add(
		'deal-closed',
		{
			workspaceId,
			contactId,
			envelope: {
				encryptedWrk: envelope.encryptedWrk.toString('base64'),
				kmsContext: envelope.kmsContext,
				wrkVersion: envelope.wrkVersion,
			},
		},
		{ jobId: `ip-${contactId}-${today}` },
	);
}
