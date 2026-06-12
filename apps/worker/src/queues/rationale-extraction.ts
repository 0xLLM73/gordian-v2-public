import type { SealedEnvelope } from '@repo/crypto';
import { deriveKeys, unwrapWrk } from '@repo/crypto';
import { getMessagesByContact } from '@repo/db';
import { canRunCloudRationaleExtraction, redactSensitive } from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

export interface RationaleJobData {
	action: string;
	label: string;
	contactId?: string;
	entityId?: string;
	entityType?: 'deal' | 'introduction' | 'recommendation' | 'commitment' | 'contact';
	workspaceId: string;
	// SEC-PROV-003: NEVER include workspaceSalt (BIK) in job payloads.
	// SEC-PROV-004: keyEnvelope is REQUIRED — worker needs it to derive keys.
	keyEnvelope: {
		encryptedWrk: string; // Base64-encoded encrypted WRK
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
}

export const rationaleQueue = new Queue('rationale-extraction', {
	connection,
	prefix: '{ai-flow}', // Same hashtag — prevents CROSSSLOT ERR-008
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 5000 },
		removeOnComplete: 100,
		removeOnFail: 50,
	},
});

/**
 * Rationale extraction worker — receives decision events from the web app,
 * fetches + decrypts recent messages, and calls extractDecisionRationales()
 * to persist structured rationales into the knowledge graph.
 */
export const rationaleExtractionWorker = new Worker(
	'rationale-extraction',
	withRLS(async (job) => {
		const data = job.data as RationaleJobData;
		const { action, label, contactId, entityId, entityType, workspaceId, keyEnvelope } = data;

		if (!canRunCloudRationaleExtraction()) {
			console.log(
				`[rationale] Cloud rationale extraction disabled for workspace=${workspaceId.slice(0, 8)}, skipping`,
			);
			return { skipped: true, reason: 'cloud_rationale_extraction_disabled' };
		}

		if (!keyEnvelope) {
			throw new Error('[rationale] Missing keyEnvelope in job data (SEC-PROV-004)');
		}

		if (!contactId) {
			console.log(
				`[rationale] No contactId for ${action} entity=${entityId?.slice(0, 8)}, skipping message fetch`,
			);
			return;
		}

		// 1. Reconstruct SealedEnvelope from job payload
		const envelope: SealedEnvelope = {
			encryptedWrk: Buffer.from(keyEnvelope.encryptedWrk, 'base64'),
			kmsContext: keyEnvelope.kmsContext,
			wrkVersion: keyEnvelope.wrkVersion,
		};

		// 2. Unwrap WRK → derive DEK + BIK (SEC-PROV-003: BIK derived here, never in payload)
		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);

		// 3. Fetch + decrypt recent messages for the contact (last 50)
		// getMessagesByContact uses withKeys() internally for auto-decryption
		const messages = await getMessagesByContact(workspaceId, contactId, envelope, {
			limit: 50,
		});

		if (messages.length === 0) {
			console.log(
				`[rationale] No messages for contact=${contactId.slice(0, 8)}, skipping extraction`,
			);
			return;
		}

		// 4. Extract message texts for the extraction service
		const messageTexts = messages.map((m) => m.text).filter((t): t is string => t != null);

		// 5. Call rationale extraction (dpg-03, Nerid)
		const { extractDecisionRationales } = await import('../ai/rationale-extraction');

		await extractDecisionRationales(
			{
				action,
				label,
				contactId,
				entityId,
				entityType,
				workspaceId,
				workspaceSalt: keys.bik, // BIK serves as workspace salt for ELM masking
				envelope,
			},
			messageTexts,
		);

		console.log(
			`[rationale] Extraction complete for ${action} contact=${contactId.slice(0, 8)} workspace=${workspaceId.slice(0, 8)}`,
		);
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 2 },
);

rationaleExtractionWorker.on('completed', (job) => {
	console.log(`[rationale] Job ${job.id} completed`);
});
rationaleExtractionWorker.on('failed', (job, err) => {
	console.error(`[rationale] Job ${job?.id} failed:`, redactSensitive(err));
});
