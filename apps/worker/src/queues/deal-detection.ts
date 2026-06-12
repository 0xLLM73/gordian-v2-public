/**
 * GC5 — Deal Detection Queue
 *
 * BullMQ queue + worker that runs the 3-layer deal detection pipeline:
 * Layer 1 (GC2): Regex sieve — runs inline in sync.ts as pre-filter
 * Layer 2 (GC3): Binary classifier — Gemini Flash
 * Layer 3 (GC4): LLM extraction — Gemini Flash structured output
 *
 * Queue uses {ai-flow} hashtag to prevent CROSSSLOT errors on DragonflyDB.
 *
 * CRITICAL: Message text arrives encrypted in the job payload (SEC-006).
 * Worker decrypts, then ELM-masks before calling GC3/GC4 (SEC-S7-003/004).
 */

import { decrypt, deriveKeys, maskEntities, type SealedEnvelope, unwrapWrk } from '@repo/crypto';
import { hasUserAiAnalysisConsent } from '@repo/db';
import { redactSensitive } from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { classifyDealIntent } from '../ai/deal-classifier';
import { extractDealCandidate } from '../ai/deal-extraction';
import { prefilterEntities } from '../ai/prefilter';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface DealDetectionJobData {
	/** Encrypted message text (AES-256-GCM via DEK) — never plaintext in Redis */
	encryptedText: string;
	chatId: string;
	sourceMessageId: string;
	userId: string;
	workspaceId: string;
	contactId?: string;
	/** Encrypted key envelope — never plaintext keys in job payloads */
	keyEnvelope: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
}

// ─── Queue ──────────────────────────────────────────────────────────────────────

export const dealDetectionQueue = new Queue<DealDetectionJobData>('deal-detection', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 5000 },
		removeOnComplete: true,
		removeOnFail: { count: 25, age: 3600 },
	},
});

// ─── Helpers ────────────────────────────────────────────────────────────────────

function envelopeFromJob(data: DealDetectionJobData): SealedEnvelope {
	return {
		encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
		kmsContext: data.keyEnvelope.kmsContext,
		wrkVersion: data.keyEnvelope.wrkVersion,
	};
}

// ─── Worker ─────────────────────────────────────────────────────────────────────

export const dealDetectionWorker = new Worker<DealDetectionJobData>(
	'deal-detection',
	withRLS(async (job) => {
		const data = job.data;
		const { workspaceId, chatId, sourceMessageId, contactId, userId } = data;

		if (!(await hasUserAiAnalysisConsent(userId, workspaceId))) {
			console.log(
				`[deal-detection] AI consent no longer persisted for workspace=${workspaceId.slice(0, 8)} user=${userId.slice(0, 8)}, skipping`,
			);
			return { skipped: true, reason: 'no_ai_consent' };
		}

		// Step 1: Decrypt message text
		const envelope = envelopeFromJob(data);
		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
		const messageText = decrypt(data.encryptedText, keys.dek);

		// Step 2: ELM-mask before sending to Gemini API (SEC-S7-003, SEC-S7-004)
		const detected = prefilterEntities(messageText);
		const { maskedText } = maskEntities(messageText, keys.bik, detected);

		// Step 3: Layer 2 — GC3 binary classifier
		const classification = await classifyDealIntent(maskedText);
		if (!classification.isInvestmentDiscussion) {
			console.log(
				`[deal-detection] GC3 rejected (confidence=${classification.confidence.toFixed(2)}) chat=${chatId.slice(0, 8)}`,
			);
			return { layer: 'gc3', passed: false };
		}

		// Step 4: Layer 3 — GC4 extraction + storage
		const candidate = await extractDealCandidate(
			maskedText,
			chatId,
			sourceMessageId,
			workspaceId,
			envelope,
			contactId,
		);

		if (candidate) {
			console.log(
				`[deal-detection] Deal candidate created (type=${candidate.dealTypeGuess}) chat=${chatId.slice(0, 8)}`,
			);
			return { layer: 'gc4', passed: true, candidateId: candidate.id };
		}

		return { layer: 'gc4', passed: false };
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 3 },
);

// ─── Event Logging ──────────────────────────────────────────────────────────────

dealDetectionWorker.on('failed', (job, err) => {
	console.error(`[deal-detection] Job ${job?.id} failed:`, redactSensitive(err));
});
