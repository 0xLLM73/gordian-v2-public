import { decrypt, deriveKeys, maskEntities, unwrapWrk } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { hasUserAiAnalysisConsent, isFeatureEnabled, upsertContactStyleOverride } from '@repo/db';
import { redactSensitive } from '@repo/shared';
import { Worker } from 'bullmq';
import { prefilterEntities } from '../ai/prefilter';
import { extractStyleFeatures } from '../ai/style-analysis';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

interface JobData {
	userId: string;
	contactId: string;
	workspaceId: string;
	keyEnvelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
	/** Encrypted messages — decrypted via unwrapWrk+deriveKeys in this worker */
	messages?: Array<{ role: string; content: string; timestamp: string }>;
	workspaceSalt?: string;
}

function envelopeFromJob(data: JobData): SealedEnvelope | null {
	if (!data.keyEnvelope) return null;
	return {
		encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
		kmsContext: data.keyEnvelope.kmsContext,
		wrkVersion: data.keyEnvelope.wrkVersion,
	};
}

export const styleAnalysisWorker = new Worker(
	'style-analysis',
	withRLS(async (job) => {
		const data = job.data as JobData;
		const { contactId, workspaceId, userId } = data;

		if (!(await hasUserAiAnalysisConsent(userId, workspaceId))) {
			console.log(
				`[style-analysis] AI consent no longer persisted for workspace=${workspaceId.slice(0, 8)} user=${userId.slice(0, 8)}, skipping`,
			);
			return;
		}

		// Feature flag guard
		const enabled = await isFeatureEnabled('voice_profile_collection', workspaceId);
		if (!enabled) return;

		if (!data.messages || data.messages.length === 0) return;

		// [SEC-FIX MED-1] Log missing envelope instead of silent return
		const envelope = envelopeFromJob(data);
		if (!envelope) {
			console.error(
				`[style-analysis] No key envelope for contact=${contactId.slice(0, 8)}, skipping`,
			);
			return;
		}

		// Decrypt messages (ciphertext in BullMQ payload)
		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
		const decrypted = data.messages.map((m) => ({
			content: decrypt(m.content, keys.dek),
			isOutgoing: m.role === 'user',
		}));

		// Filter to outgoing only
		const outgoing = decrypted.filter((m) => m.isOutgoing);
		if (outgoing.length < 5) return;

		// Extract features (deterministic, ~1ms)
		const features = extractStyleFeatures(outgoing.map((m) => ({ content: m.content })));

		// Store per-contact override (DAL verifies contact belongs to workspace)
		await upsertContactStyleOverride(workspaceId, contactId, features);

		console.log(
			`[style-analysis] Extracted features from ${outgoing.length} messages for contact=${contactId.slice(0, 8)}`,
		);

		// AI analysis step — gated behind separate feature flag
		const aiEnabled = await isFeatureEnabled('voice_profile_ai', workspaceId);
		if (!aiEnabled || !data.workspaceSalt) return;

		try {
			// Sample up to 30 diverse messages (spread across the set, not just recent)
			const step = Math.max(1, Math.floor(outgoing.length / 30));
			const sampled = outgoing.filter((_, i) => i % step === 0).slice(0, 30);

			// ELM mask all message text before sending to AI
			if (!data.workspaceSalt) throw new Error('workspaceSalt missing');
			const salt = Buffer.from(data.workspaceSalt, 'hex');
			const maskedSamples = sampled.map((m) => {
				const detected = prefilterEntities(m.content);
				const { maskedText } = maskEntities(m.content, salt, detected);
				return maskedText;
			});

			// Lazy import to avoid loading AI deps when flag is off
			const { analyzeStylePerCategory } = await import('../ai/style-ai-analysis');
			const categoryResult = await analyzeStylePerCategory(features, maskedSamples, 'general');

			console.log(
				`[style-analysis] AI analysis complete for contact=${contactId.slice(0, 8)}: formality=${categoryResult.formality}`,
			);

			// Return for aggregation to pick up
			return { features, richAnalysis: categoryResult };
		} catch (err) {
			// Non-fatal — deterministic features are already stored
			console.warn(
				`[style-analysis] AI analysis failed for contact=${contactId.slice(0, 8)}:`,
				redactSensitive(err),
			);
		}
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 3 },
);

styleAnalysisWorker.on('completed', (job) => {
	console.log(`[style-analysis] Job ${job.id} completed`);
});
styleAnalysisWorker.on('failed', (job, err) => {
	console.error(`[style-analysis] Job ${job?.id} failed:`, redactSensitive(err));
});
