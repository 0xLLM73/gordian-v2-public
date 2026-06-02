import { decrypt, deriveKeys, unwrapWrk } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import {
	getActiveGoalsByType,
	getCommitmentsForFulfillmentCheck,
	hasUserAiAnalysisConsent,
	markCommitmentFulfilled,
	updateGoalProgress,
	updateLastCheckedAt,
} from '@repo/db';
import { canRunCloudCommitmentIntelligence, redactSensitive } from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { recordOutcome } from '../ai/bandit';
import { detectFulfillment } from '../ai/fulfillment-detection';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';
import { enqueueCommitmentEvaluation } from './outcome-evaluation';

interface FulfillmentJobData {
	userId: string;
	contactId: string;
	workspaceId: string;
	/** Encrypted key envelope — NEVER plaintext keys in job payloads */
	keyEnvelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
	/** Messages to check for fulfillment (already decrypted by caller) */
	messages?: Array<{ role: string; content: string; timestamp: string }>;
	/** Workspace salt for entity masking (hex-encoded) */
	workspaceSalt?: string;
}

function envelopeFromJob(data: FulfillmentJobData): SealedEnvelope | null {
	if (!data.keyEnvelope) return null;
	return {
		encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
		kmsContext: data.keyEnvelope.kmsContext,
		wrkVersion: data.keyEnvelope.wrkVersion,
	};
}

export const fulfillmentQueue = new Queue<FulfillmentJobData>('fulfillment', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 5000 },
		removeOnComplete: true,
		removeOnFail: { count: 50, age: 3600 },
	},
});

export const fulfillmentWorker = new Worker<FulfillmentJobData>(
	'fulfillment',
	withRLS(async (job) => {
		const { userId, contactId, workspaceId } = job.data;

		if (!canRunCloudCommitmentIntelligence()) {
			console.log(
				`[fulfillment] Cloud fulfillment detection disabled for workspace=${workspaceId.slice(0, 8)}, skipping`,
			);
			return { skipped: true, reason: 'cloud_commitment_intelligence_disabled' };
		}

		if (!(await hasUserAiAnalysisConsent(userId, workspaceId))) {
			console.log(
				`[fulfillment] AI consent no longer persisted for workspace=${workspaceId.slice(0, 8)} user=${userId.slice(0, 8)}, skipping`,
			);
			return { skipped: true, reason: 'no_ai_consent' };
		}

		if (!job.data.messages || job.data.messages.length === 0) {
			console.log(`[fulfillment] No messages for contact=${contactId.slice(0, 8)}, skipping`);
			return { skipped: true, reason: 'no_messages' };
		}

		const envelope = envelopeFromJob(job.data);
		if (!envelope) {
			console.log(`[fulfillment] No key envelope for contact=${contactId.slice(0, 8)}, skipping`);
			return { skipped: true, reason: 'no_envelope' };
		}

		if (!job.data.workspaceSalt) {
			console.error(
				`[fulfillment] Missing workspace salt for contact=${contactId.slice(0, 8)}, refusing to mask with weak fallback`,
			);
			return { skipped: true, reason: 'no_salt' };
		}
		const salt = Buffer.from(job.data.workspaceSalt, 'hex');

		// Decrypt message content from BullMQ payload (SEC-006)
		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
		const messages = job.data.messages.map((m) => ({
			role: m.role,
			content: decrypt(m.content, keys.dek),
			timestamp: m.timestamp,
		}));

		// 1. Get active commitments for this contact
		const activeCommitments = await getCommitmentsForFulfillmentCheck(
			workspaceId,
			contactId,
			envelope,
		);

		if (activeCommitments.length === 0) {
			console.log(
				`[fulfillment] No active commitments for contact=${contactId.slice(0, 8)}, skipping`,
			);
			return { skipped: true, reason: 'no_active_commitments' };
		}

		console.log(
			`[fulfillment] Checking ${activeCommitments.length} commitments against ${messages.length} messages for contact=${contactId.slice(0, 8)}`,
		);

		// 2. Run AI detection
		const { results, traceId, variant } = await detectFulfillment(
			activeCommitments.map((c) => ({
				id: c.id,
				title: c.title,
				commitmentType: c.commitmentType,
				dueDate: c.dueDate ?? undefined,
			})),
			messages,
			salt,
			userId,
		);

		// 3. Mark fulfilled commitments in DB
		let fulfilled = 0;
		for (const result of results) {
			const fulfilledCommitment = await markCommitmentFulfilled(
				workspaceId,
				result.commitmentId,
				result.evidence,
				envelope,
			);
			fulfilled++;
			// Bandit hook: strong positive signal for fulfilled commitment
			try {
				if (fulfilledCommitment?.banditTraceId) {
					await recordOutcome(fulfilledCommitment.banditTraceId, 1.0);
				}
			} catch {}
			// Goal hook: increment habit goals on commitment fulfilled
			try {
				const habitGoals = await getActiveGoalsByType(workspaceId, 'habit', undefined, envelope);
				for (const goal of habitGoals) {
					await updateGoalProgress(workspaceId, goal.id, 1, 'habit');
				}
			} catch (err) {
				console.warn('[goal-hook] Failed to increment habit goal', redactSensitive(err));
			}
			// Outcome hook (Phase 35): record fulfilled outcome for precedent search
			try {
				await enqueueCommitmentEvaluation(workspaceId, result.commitmentId, 'fulfilled');
			} catch {}
			console.log(
				`[fulfillment] Marked commitment ${result.commitmentId.slice(0, 8)} as fulfilled (confidence=${result.confidence})`,
			);
		}

		// 4. Update lastCheckedAt for ALL checked commitments (even unfulfilled)
		const allCheckedIds = activeCommitments.map((c) => c.id);
		await updateLastCheckedAt(workspaceId, allCheckedIds);

		console.log(
			`[fulfillment] Done: checked=${activeCommitments.length} fulfilled=${fulfilled} variant=${variant}`,
		);

		return { traceId, variant, checked: activeCommitments.length, fulfilled };
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 5 },
);

fulfillmentWorker.on('completed', (job) => {
	console.log(`[fulfillment] Job ${job.id} completed`);
});
fulfillmentWorker.on('failed', (job, err) => {
	console.error(`[fulfillment] Job ${job?.id} failed:`, redactSensitive(err));
});
