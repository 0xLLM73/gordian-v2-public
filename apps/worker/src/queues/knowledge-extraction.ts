import type { SealedEnvelope } from '@repo/crypto';
import { decrypt, deriveKeys, unwrapWrk } from '@repo/crypto';
import { isFeatureEnabled } from '@repo/db';
import { Worker } from 'bullmq';
import { extractKnowledgeEntities } from '../ai/knowledge-extraction';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

interface KnowledgeJobData {
	contactId: string;
	workspaceId: string;
	workspaceSalt?: string; // hex-encoded Buffer
	messages?: Array<{ role: string; content: string; timestamp: string }>;
	keyEnvelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
}

/**
 * Knowledge extraction worker — extracts knowledge entities from messages
 * and links them to the contact in the knowledge graph.
 *
 * Non-fatal: errors are logged but never propagate to break the parent pipeline.
 * Feature-flag gated: 'knowledge_extraction' flag must be enabled per workspace.
 */
export const knowledgeExtractionWorker = new Worker(
	'knowledge-extraction',
	withRLS(async (job) => {
		const data = job.data as KnowledgeJobData;
		const { contactId, workspaceId } = data;

		if (!data.messages || data.messages.length === 0) {
			console.log(`[knowledge] No messages for contact=${contactId.slice(0, 8)}, skipping`);
			return;
		}

		const enabled = await isFeatureEnabled('knowledge_extraction', workspaceId);
		if (!enabled) {
			console.log(
				`[knowledge] Feature disabled for workspace=${workspaceId.slice(0, 8)}, skipping`,
			);
			return;
		}

		if (!data.workspaceSalt) {
			console.error(
				`[knowledge] Missing workspaceSalt for contact=${contactId.slice(0, 8)}, skipping`,
			);
			return;
		}
		if (!data.keyEnvelope) {
			console.error(
				`[knowledge] Missing keyEnvelope for contact=${contactId.slice(0, 8)}, skipping`,
			);
			return;
		}
		const salt = Buffer.from(data.workspaceSalt, 'hex');

		// Construct SealedEnvelope for DAL encryption context
		const envelope: SealedEnvelope = {
			encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
			kmsContext: data.keyEnvelope.kmsContext,
			wrkVersion: data.keyEnvelope.wrkVersion,
		};

		// Decrypt messages using derived keys
		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
		const texts = data.messages.map((m) => decrypt(m.content, keys.dek));

		await extractKnowledgeEntities(texts, contactId, workspaceId, salt, envelope);

		// Schedule debounced inference to link newly extracted nodes
		try {
			const { knowledgeInferenceQueue } = await import('./knowledge-inference');
			await knowledgeInferenceQueue.add(
				'infer',
				{ workspaceId },
				{ jobId: `infer-${workspaceId}`, delay: 30000 },
			);
		} catch (err) {
			console.error('[knowledge] Inference scheduling failed:', (err as Error).message);
		}

		console.log(
			`[knowledge] Extraction complete for contact=${contactId.slice(0, 8)} workspace=${workspaceId.slice(0, 8)}`,
		);
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 2 },
);

knowledgeExtractionWorker.on('completed', (job) => {
	console.log(`[knowledge] Job ${job.id} completed`);
});
knowledgeExtractionWorker.on('failed', (job, err) => {
	console.error(`[knowledge] Job ${job?.id} failed:`, err.message);
});
