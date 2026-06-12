import type { SealedEnvelope } from '@repo/crypto';
import { decrypt, deriveKeys, maskEntities, unwrapWrk } from '@repo/crypto';
import {
	createDecision,
	createEdge,
	findRecentDecision,
	findSimilarDecisions,
	hasUserAiAnalysisConsent,
} from '@repo/db';
import { redactSensitive } from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { generateEmbedding } from '../ai/embeddings';
import { prefilterEntities } from '../ai/prefilter';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

export interface DecisionJobData {
	userId: string;
	contactId: string;
	workspaceId: string;
	/** Pipeline child job: carries envelope for decryption */
	keyEnvelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
	/** Messages to process (already decrypted by caller, encrypted in payload) */
	messages?: Array<{ role: string; content: string; timestamp: string }>;
	/** Workspace salt for entity masking (hex-encoded) */
	workspaceSalt?: string;
	/** Web hook: explicit decision metadata */
	decisionType?: 'message' | 'click' | 'view' | 'purchase' | 'commitment' | 'dismissal';
	label?: string;
	entityId?: string;
}

export const decisionQueue = new Queue('decision-recording', {
	connection,
	prefix: '{ai-flow}', // Same hashtag — prevents CROSSSLOT ERR-008
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 5000 },
		removeOnComplete: true,
		removeOnFail: { count: 50, age: 3600 },
	},
});

/**
 * Decision recording worker.
 *
 * Two entry paths:
 * 1. Pipeline child job (ai-flow): receives messages + envelope, classifies decisions via heuristics
 * 2. Web hook (POST /decision/record): receives explicit decision metadata
 *
 * After storing a decision, creates temporal and semantic edges (Phase 2).
 */
export const decisionRecordingWorker = new Worker(
	'decision-recording',
	withRLS(async (job) => {
		const data = job.data as DecisionJobData;

		if (!(await hasUserAiAnalysisConsent(data.userId, data.workspaceId))) {
			console.log(
				`[decision] AI consent no longer persisted for workspace=${data.workspaceId.slice(0, 8)} user=${data.userId.slice(0, 8)}, skipping`,
			);
			return { skipped: true, reason: 'no_ai_consent' };
		}

		// Web hook path: explicit decision from web action
		if (data.decisionType && data.label) {
			await recordExplicitDecision(data);
			return;
		}

		// Pipeline path: classify decisions from messages
		await recordPipelineDecisions(data);
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 3 },
);

/**
 * Record an explicit decision from a web action hook.
 * Called when Charon fires fireDecisionRecording() from commitments/deals/etc.
 */
async function recordExplicitDecision(data: DecisionJobData): Promise<void> {
	const { workspaceId, decisionType, label, entityId, keyEnvelope } = data;

	if (!keyEnvelope || !decisionType || !label) {
		console.log('[decision] Missing keyEnvelope or decision metadata, skipping');
		return;
	}

	const envelope: SealedEnvelope = {
		encryptedWrk: Buffer.from(keyEnvelope.encryptedWrk, 'base64'),
		kmsContext: keyEnvelope.kmsContext,
		wrkVersion: keyEnvelope.wrkVersion,
	};

	// Derive keys for ELM masking (SEC-PROV-003: BIK derived here, never in payload)
	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);

	// ELM-mask label before embedding (SEC-122)
	const detected = prefilterEntities(label);
	const { maskedText } = maskEntities(label, keys.bik, detected);
	const embedding = await generateEmbedding(maskedText);

	const decision = await createDecision(
		workspaceId,
		{
			userId: data.userId,
			rawContent: label, // SEC-PROV-009: structural label only
			decisionType,
			embedding,
			interactionMetadata: {
				source: 'web_hook',
				entityType: data.contactId ? 'contact_action' : 'workspace_action',
			},
			entityId,
		},
		envelope,
	);

	if (!decision) return;

	console.log(
		`[decision] Recorded explicit ${decisionType} for workspace=${workspaceId.slice(0, 8)}`,
	);

	// Create edges (Phase 2)
	await createEdgesForDecision(workspaceId, decision.id, embedding);
}

/**
 * Record decisions from AI pipeline messages.
 * Classifies messages containing commitment/dismissal keywords.
 */
async function recordPipelineDecisions(data: DecisionJobData): Promise<void> {
	const { userId, contactId, workspaceId } = data;

	if (!data.messages || data.messages.length === 0) {
		console.log(`[decision] No messages for contact=${contactId.slice(0, 8)}`);
		return;
	}

	const envelope = data.keyEnvelope
		? ({
				encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
				kmsContext: data.keyEnvelope.kmsContext,
				wrkVersion: data.keyEnvelope.wrkVersion,
			} satisfies SealedEnvelope)
		: null;

	if (!envelope) {
		console.log(`[decision] No key envelope for contact=${contactId.slice(0, 8)}, skipping`);
		return;
	}

	if (!data.workspaceSalt) {
		console.log('[decision] No workspaceSalt — cannot mask, skipping');
		return;
	}

	// Decrypt messages from payload (SEC-006)
	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
	const messages = data.messages.map((m) => ({
		role: m.role,
		content: decrypt(m.content, keys.dek),
		timestamp: m.timestamp,
	}));

	const salt = Buffer.from(data.workspaceSalt, 'hex');

	// Classify decisions using keyword heuristics (fast, no LLM needed)
	// Focus on commitment and dismissal — the most meaningful decision types
	const COMMITMENT_KEYWORDS = [
		'i will',
		"i'll",
		'let me',
		'i can',
		'i promise',
		'deal',
		'agreed',
		'commit',
		'sure thing',
		'count on me',
		'will do',
		'on it',
	];
	const DISMISSAL_KEYWORDS = [
		'not interested',
		'pass on',
		'decline',
		'no thanks',
		'skip',
		"won't",
		'not going to',
		'changed my mind',
		'cancel',
		'drop it',
	];

	let stored = 0;

	for (const msg of messages) {
		// Only classify outgoing messages (user's decisions)
		if (msg.role !== 'user' && msg.role !== 'outgoing') continue;

		const lower = msg.content.toLowerCase();
		let decisionType: 'commitment' | 'dismissal' | null = null;

		if (COMMITMENT_KEYWORDS.some((k) => lower.includes(k))) {
			decisionType = 'commitment';
		} else if (DISMISSAL_KEYWORDS.some((k) => lower.includes(k))) {
			decisionType = 'dismissal';
		}

		if (!decisionType) continue;

		// ELM-mask before embedding (SEC-122)
		const detected = prefilterEntities(msg.content);
		const { maskedText } = maskEntities(msg.content, salt, detected);
		const embedding = await generateEmbedding(maskedText);

		const decision = await createDecision(
			workspaceId,
			{
				userId,
				rawContent: msg.content,
				decisionType,
				embedding,
				interactionMetadata: {
					source: 'pipeline',
					contactId,
					timestamp: msg.timestamp,
				},
			},
			envelope,
		);

		if (!decision) continue;
		stored++;

		// Create edges (Phase 2)
		await createEdgesForDecision(workspaceId, decision.id, embedding);
	}

	if (stored > 0) {
		console.log(
			`[decision] Recorded ${stored} decisions for contact=${contactId.slice(0, 8)} workspace=${workspaceId.slice(0, 8)}`,
		);
	}
}

/**
 * Phase 2: Create temporal + semantic edges for a newly recorded decision.
 */
async function createEdgesForDecision(
	workspaceId: string,
	decisionId: string,
	embedding: number[],
): Promise<void> {
	// 2a. Temporal edge: link to most recent prior decision within 24h
	try {
		const recent = await findRecentDecision(workspaceId, {
			excludeId: decisionId,
			withinHours: 24,
		});

		if (recent) {
			await createEdge(workspaceId, {
				sourceId: recent.id,
				targetId: decisionId,
				edgeType: 'temporal',
				weight: 0.3, // Low default — proximity ≠ causation
				confidenceScore: 0.5,
			});
		}
	} catch (err) {
		console.error('[decision] Temporal edge creation failed:', redactSensitive(err));
	}

	// 2b. Semantic edges: find similar decisions (cosine > 0.85)
	try {
		const similar = await findSimilarDecisions(workspaceId, embedding, {
			excludeId: decisionId,
			minSimilarity: 0.85,
			limit: 3,
		});

		for (const match of similar) {
			await createEdge(workspaceId, {
				sourceId: match.id,
				targetId: decisionId,
				edgeType: 'semantic',
				weight: match.similarity * 0.5,
				confidenceScore: match.similarity,
			});
		}
	} catch (err) {
		console.error('[decision] Semantic edge creation failed:', redactSensitive(err));
	}
}

decisionRecordingWorker.on('completed', (job) => {
	console.log(`[decision] Job ${job.id} completed`);
});
decisionRecordingWorker.on('failed', (job, err) => {
	console.error(`[decision] Job ${job?.id} failed:`, redactSensitive(err));
});
