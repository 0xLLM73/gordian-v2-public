import { decrypt, deriveKeys, maskEntities, unwrapWrk } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import {
	createCommitment,
	createGoalProposal,
	createMemory,
	hasUserAiAnalysisConsent,
	isDuplicateGoal,
	upsertSummary,
} from '@repo/db';
import {
	canRunCloudCommitmentIntelligence,
	canRunCommitmentExtraction,
	canRunEmbeddingGeneration,
	getCommitmentLlmRuntime,
	isVendorAiEgressEnabled,
	redactSensitive,
} from '@repo/shared';
import { FlowProducer, Worker } from 'bullmq';
import { extractCommitmentsWithBandit } from '../ai/commitment-extraction';
import {
	filterCommitmentsByV2Validation,
	isCommitmentV2ShadowEnabled,
	isCommitmentV2ValidationEnabled,
} from '../ai/commitment-v2';
import { type CommitmentSensitivity, getConfidenceThresholds } from '../ai/confidence-thresholds';
import { generateContactSummary } from '../ai/contact-summary';
import { deduplicateCommitment } from '../ai/dedup';
import { generateEmbedding, generateEmbeddingsCached } from '../ai/embeddings';
import { recordExtractionFeedback } from '../ai/feedback-signals';
import { extractGoals } from '../ai/goal-extraction';
import { prefilterEntities } from '../ai/prefilter';
import { trackWorkerEvent as trackAnalyticsEvent } from '../lib/track';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

/**
 * FlowProducer for AI pipeline jobs (followup6).
 * CRITICAL: All queues use prefix '{ai-flow}' so Redis keys share
 * the same hashtag, preventing CROSSSLOT errors on DragonflyDB (ERR-008).
 *
 * BullMQ constructs keys as {prefix}:{name}, so prefix='{ai-flow}'
 * + name='orchestrator' → Redis key '{ai-flow}:orchestrator'.
 */
export const aiFlowProducer = new FlowProducer({
	connection,
	prefix: '{ai-flow}',
});

export interface PipelineMessage {
	id?: string;
	role: string;
	content: string;
	timestamp: string;
	sourceMessageId?: string;
	chatId?: string;
	contactId?: string;
}

interface JobData {
	userId: string;
	contactId: string;
	workspaceId: string;
	sourceAccountId?: string;
	skipWorkspaceRelationshipDerivation?: boolean;
	/** Encrypted key envelope — NEVER plaintext keys in job payloads */
	keyEnvelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
	/** Messages to process (encrypted before entering BullMQ) */
	messages?: PipelineMessage[];
	/** Workspace salt for entity masking (hex-encoded) */
	workspaceSalt?: string;
	/** User's Coffee Test answer — drives dynamic confidence thresholds */
	commitmentSensitivity?: CommitmentSensitivity;
}

const SENSITIVE_AI_FLOW_JOB_OPTS = {
	attempts: 2,
	backoff: { type: 'exponential' as const, delay: 5000 },
	removeOnComplete: true,
	removeOnFail: { count: 50, age: 3600 },
};

function positiveIntegerEnv(
	name: string,
	fallback: number,
	env: NodeJS.ProcessEnv = process.env,
): number {
	const parsed = Number(env[name]);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function aiExtractionWorkerConcurrency(env: NodeJS.ProcessEnv = process.env): number {
	const runtime = getCommitmentLlmRuntime(env);
	const localDefault = runtime.mode === 'local' ? 1 : 3;
	return positiveIntegerEnv('AI_EXTRACTION_WORKER_CONCURRENCY', localDefault, env);
}

const LONG_RUNNING_AI_WORKER_OPTS = {
	lockDuration: positiveIntegerEnv('AI_FLOW_WORKER_LOCK_DURATION_MS', 10 * 60 * 1000),
	stalledInterval: positiveIntegerEnv('AI_FLOW_WORKER_STALLED_INTERVAL_MS', 60 * 1000),
	maxStalledCount: positiveIntegerEnv('AI_FLOW_WORKER_MAX_STALLED_COUNT', 2),
};

function aiFlowWorkerOptions(concurrency: number) {
	return {
		connection,
		prefix: '{ai-flow}',
		concurrency,
		...LONG_RUNNING_AI_WORKER_OPTS,
	};
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
	return UUID_RE.test(value);
}

function commitmentStorageRoute(
	confidence: number,
	storageThreshold: number,
	localCommitmentMode: boolean,
): 'active' | 'draft' | 'discard' {
	if (confidence < storageThreshold) return 'discard';
	if (localCommitmentMode) return 'draft';
	return confidence > 0.9 ? 'active' : 'draft';
}

/**
 * Reconstruct SealedEnvelope from job data.
 * Job payloads carry keyEnvelope (encrypted blob), NEVER plaintext keys.
 */
function envelopeFromJob(data: JobData): SealedEnvelope | null {
	if (!data.keyEnvelope) return null;
	return {
		encryptedWrk: Buffer.from(data.keyEnvelope.encryptedWrk, 'base64'),
		kmsContext: data.keyEnvelope.kmsContext,
		wrkVersion: data.keyEnvelope.wrkVersion,
	};
}

async function requirePersistedAiConsent(data: JobData, stage: string): Promise<boolean> {
	if (await hasUserAiAnalysisConsent(data.userId, data.workspaceId)) return true;
	console.log(
		`[${stage}] AI consent no longer persisted for workspace=${data.workspaceId.slice(0, 8)} user=${data.userId.slice(0, 8)}, skipping`,
	);
	return false;
}

/**
 * Schedule the full AI pipeline for a contact.
 * Creates a parent "orchestrator" job with child jobs for
 * extraction and embeddings that run in parallel.
 */
export async function scheduleAIPipeline(
	userId: string,
	contactId: string,
	workspaceId: string,
	keyEnvelope?: JobData['keyEnvelope'],
	messages?: JobData['messages'],
	workspaceSalt?: string,
	commitmentSensitivity?: CommitmentSensitivity,
	sourceAccountId?: string,
	options?: {
		skipWorkspaceRelationshipDerivation?: boolean;
	},
) {
	if (!(await hasUserAiAnalysisConsent(userId, workspaceId))) {
		throw new Error('AI analysis consent is required before scheduling the AI pipeline');
	}

	const data: JobData = {
		userId,
		contactId,
		workspaceId,
		sourceAccountId,
		keyEnvelope,
		messages,
		workspaceSalt,
		commitmentSensitivity,
		skipWorkspaceRelationshipDerivation: options?.skipWorkspaceRelationshipDerivation,
	};
	const cloudCommitmentEnabled = canRunCloudCommitmentIntelligence();
	const commitmentExtractionEnabled = canRunCommitmentExtraction();
	const embeddingGenerationEnabled = canRunEmbeddingGeneration();
	const vendorAiEnabled = isVendorAiEgressEnabled();

	return aiFlowProducer.add({
		name: 'ai-pipeline',
		queueName: 'orchestrator',
		data,
		prefix: '{ai-flow}',
		opts: SENSITIVE_AI_FLOW_JOB_OPTS,
		children: [
			...(commitmentExtractionEnabled
				? [
						{
							name: 'extract-commitments',
							queueName: 'extraction',
							data,
							prefix: '{ai-flow}',
							opts: SENSITIVE_AI_FLOW_JOB_OPTS,
						},
					]
				: []),
			...(embeddingGenerationEnabled
				? [
						{
							name: 'generate-embeddings',
							queueName: 'embeddings',
							data,
							prefix: '{ai-flow}',
							opts: SENSITIVE_AI_FLOW_JOB_OPTS,
						},
					]
				: []),
			...(vendorAiEnabled
				? [
						{
							name: 'generate-summary',
							queueName: 'summaries',
							data,
							prefix: '{ai-flow}',
							opts: SENSITIVE_AI_FLOW_JOB_OPTS,
						},
					]
				: []),
			...(cloudCommitmentEnabled
				? [
						{
							name: 'check-fulfillment',
							queueName: 'fulfillment',
							data,
							prefix: '{ai-flow}',
							opts: SENSITIVE_AI_FLOW_JOB_OPTS,
						},
					]
				: []),
			...(embeddingGenerationEnabled
				? [
						{
							name: 'extract-knowledge',
							queueName: 'knowledge-extraction',
							data,
							prefix: '{ai-flow}',
							opts: SENSITIVE_AI_FLOW_JOB_OPTS,
						},
					]
				: []),
			...(vendorAiEnabled
				? [
						{
							name: 'extract-relationships',
							queueName: 'relationship-extraction',
							data: {
								workspaceId: data.workspaceId,
								userId: data.userId,
								...(data.sourceAccountId ? { sourceAccountId: data.sourceAccountId } : {}),
								contactId: data.contactId,
								keyEnvelope: data.keyEnvelope,
								messages: data.messages,
								workspaceSalt: data.workspaceSalt,
							},
							prefix: '{ai-flow}',
							opts: SENSITIVE_AI_FLOW_JOB_OPTS,
						},
					]
				: []),
			{
				name: 'analyze-style',
				queueName: 'style-analysis',
				data,
				prefix: '{ai-flow}',
				opts: SENSITIVE_AI_FLOW_JOB_OPTS,
			},
			...(embeddingGenerationEnabled
				? [
						{
							name: 'record-decisions',
							queueName: 'decision-recording',
							data,
							prefix: '{ai-flow}',
							opts: SENSITIVE_AI_FLOW_JOB_OPTS,
						},
					]
				: []),
			...(vendorAiEnabled
				? [
						{
							name: 'extract-goals',
							queueName: 'goal-extraction',
							data,
							prefix: '{ai-flow}',
							opts: SENSITIVE_AI_FLOW_JOB_OPTS,
						},
					]
				: []),
		],
	});
}

/**
 * AI pipeline worker — orchestrator.
 * Runs after all children (extraction + embeddings) complete.
 */
export const orchestratorWorker = new Worker(
	'orchestrator',
	withRLS(async (job) => {
		const { contactId, workspaceId, userId } = job.data as JobData;
		const pipelineStart = Date.now();
		const data = job.data as JobData;

		if (!(await requirePersistedAiConsent(data, 'ai-orchestrator'))) {
			return { skipped: true, reason: 'no_ai_consent' };
		}

		trackAnalyticsEvent(workspaceId, userId, 'ai_pipeline.started');

		// Log child job results (structural only — no PII, SEC-026)
		const childValues = await job.getChildrenValues();
		const childResults = Object.entries(childValues);
		for (const [key, value] of childResults) {
			console.log(`[ai-orchestrator] Child ${key} completed:`, {
				hasResult: !!value,
				resultType: typeof value,
				...(Array.isArray(value) ? { count: value.length } : {}),
			});
		}

		// Derive group-chat co-occurrence relationships (workspace-level, SQL-only, no LLM).
		if (data.skipWorkspaceRelationshipDerivation) {
			console.log(
				`[ai-orchestrator] Skipping workspace relationship derivation for workspace=${workspaceId.slice(0, 8)}`,
			);
		} else {
			try {
				const { deriveGroupChatRelationships } = await import('@repo/db');
				const derived = await deriveGroupChatRelationships(workspaceId, {
					contactId: data.contactId,
				});
				if (derived > 0) {
					console.log(
						`[ai-orchestrator] Derived ${derived} group-chat relationships for contact=${data.contactId.slice(0, 8)} workspace=${workspaceId.slice(0, 8)}`,
					);
				}
			} catch (err) {
				console.error(
					'[ai-orchestrator] Failed to derive group-chat relationships:',
					redactSensitive(err),
				);
			}
		}

		trackAnalyticsEvent(workspaceId, userId, 'ai_pipeline.completed', {
			duration_ms: Date.now() - pipelineStart,
			child_count: childResults.length,
		});

		console.log(
			`[ai-orchestrator] Pipeline complete for contact=${contactId.slice(0, 8)} workspace=${workspaceId.slice(0, 8)}`,
		);
	}),
	aiFlowWorkerOptions(5),
);

/**
 * AI pipeline worker — commitment extraction.
 * Uses bandit-integrated extraction for Thompson Sampling variant selection.
 */
export const extractionWorker = new Worker(
	'extraction',
	withRLS(async (job) => {
		const data = job.data as JobData;
		const { userId, contactId, workspaceId } = data;

		if (!canRunCommitmentExtraction()) {
			console.log(
				`[ai-extraction] Commitment extraction disabled for workspace=${workspaceId.slice(0, 8)}, skipping`,
			);
			return { skipped: true, reason: 'commitment_extraction_disabled' };
		}

		if (!(await requirePersistedAiConsent(data, 'ai-extraction'))) {
			return { skipped: true, reason: 'no_ai_consent' };
		}

		if (!data.messages || data.messages.length === 0) {
			console.log(`[ai-extraction] No messages to process for contact=${contactId.slice(0, 8)}`);
			return;
		}

		const envelope = envelopeFromJob(data);
		if (!envelope) {
			console.log(`[ai-extraction] No key envelope for contact=${contactId.slice(0, 8)}, skipping`);
			return;
		}

		// Decrypt message content from BullMQ payload (SEC-006)
		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
		const messages = data.messages.map((m) => ({
			id: m.id,
			sourceMessageId: m.sourceMessageId,
			role: m.role,
			content: decrypt(m.content, keys.dek),
			timestamp: m.timestamp,
		}));
		const commitmentRuntime = getCommitmentLlmRuntime(process.env);
		const localCommitmentMode = commitmentRuntime.mode === 'local';

		console.log(
			`[ai-extraction] Extracting commitments from ${messages.length} messages for contact=${contactId.slice(0, 8)}`,
		);

		// Build extraction context transcript (last 10 messages the model sees)
		const extractionContext = messages
			.slice(-10)
			.map((m, index) => {
				const sourceId = m.sourceMessageId ?? m.id ?? `m${index + 1}`;
				return `[source:${sourceId}] [${m.role}] ${m.content}`;
			})
			.join('\n');

		// 1. Extract commitments via bandit-integrated LLM tool use
		const thresholds = getConfidenceThresholds(data.commitmentSensitivity);
		const referenceTime = new Date().toISOString();
		const {
			commitments: extracted,
			candidates: pass1Candidates,
			traceId,
			variant,
		} = await extractCommitmentsWithBandit(messages, referenceTime, userId, workspaceId, {
			extractionThreshold: thresholds.extraction,
			commitmentSensitivity: data.commitmentSensitivity,
			workspaceSalt: keys.bik,
		});

		const v2ShadowEnabled = isCommitmentV2ShadowEnabled(process.env);
		const v2ValidationEnabled = isCommitmentV2ValidationEnabled(process.env);
		let extractedForStorage = extracted;
		if (v2ShadowEnabled || v2ValidationEnabled) {
			const { report: shadowReport, commitments: validatedCommitments } =
				filterCommitmentsByV2Validation({
					messages,
					extractedCommitments: extracted,
					workspaceSalt: keys.bik,
					sourceAccountId: data.sourceAccountId,
					activeAutocreateEnabled: process.env.COMMITMENT_V2_ACTIVE_AUTOCREATE === 'true',
				});
			if (v2ShadowEnabled) {
				console.log('[commitment-v2-shadow]', JSON.stringify(shadowReport.privacySafeEvent));
				trackAnalyticsEvent(workspaceId, userId, 'commitment.v2_shadow_completed', {
					candidate_count: shadowReport.candidateCount,
					extracted_count: shadowReport.extractedCount,
					route_counts: shadowReport.routeCounts,
					failure_code_counts: shadowReport.failureCodeCounts,
					warning_code_counts: shadowReport.warningCodeCounts,
					detector_version: shadowReport.detectorVersion,
					validator_version: shadowReport.validatorVersion,
				});
			}
			if (v2ValidationEnabled) {
				extractedForStorage = validatedCommitments;
				const rejectedCount = extracted.length - extractedForStorage.length;
				if (rejectedCount > 0) {
					console.log(
						`[commitment-v2-validation] Filtered ${rejectedCount} rejected commitment candidate(s) for contact=${contactId.slice(0, 8)}`,
					);
				}
				trackAnalyticsEvent(workspaceId, userId, 'commitment.v2_validation_applied', {
					extracted_count: extracted.length,
					storage_count: extractedForStorage.length,
					rejected_count: rejectedCount,
					route_counts: shadowReport.routeCounts,
					failure_code_counts: shadowReport.failureCodeCounts,
				});
			}
		}

		if (extractedForStorage.length === 0) {
			console.log(`[ai-extraction] No commitments found for contact=${contactId.slice(0, 8)}`);
			return { traceId, variant, stored: 0, rejectedByV2: extracted.length };
		}

		trackAnalyticsEvent(workspaceId, userId, 'commitment.extracted', {
			count: extractedForStorage.length,
			raw_count: extracted.length,
			variant,
			trace_id: traceId,
		});

		console.log(
			`[ai-extraction] Found ${extractedForStorage.length} commitments (variant=${variant}) for contact=${contactId.slice(0, 8)}`,
		);

		// 2. For each extracted commitment, generate embedding + dedup + store
		let stored = 0;
		for (const commitment of extractedForStorage) {
			// Route by confidence (analytics)
			const route = commitmentStorageRoute(
				commitment.confidence,
				thresholds.storage,
				localCommitmentMode,
			);
			trackAnalyticsEvent(workspaceId, userId, 'commitment.confidence_routed', {
				confidence: commitment.confidence,
				route,
			});

			// Skip below storage threshold (dynamic from Coffee Test)
			if (commitment.confidence < thresholds.storage) {
				console.log(
					`[ai-extraction] Skipping below storage threshold (${commitment.confidence} < ${thresholds.storage})`,
				);
				continue;
			}

			// Guard: workspaceSalt required for ELM before embedding (SEC-122)
			if (!data.workspaceSalt) {
				console.log('[ai-extraction] No workspaceSalt — cannot mask commitment title, skipping');
				continue;
			}
			const salt = Buffer.from(data.workspaceSalt, 'hex');
			const detectedEntities = prefilterEntities(commitment.title);
			const { maskedText: maskedTitle } = maskEntities(commitment.title, salt, detectedEntities);
			// Generate embedding from masked title (SEC-122: never embed raw PII)
			const embedding = await generateEmbedding(maskedTitle);

			// 3-stage dedup check
			const dedupResult = await deduplicateCommitment(
				workspaceId,
				contactId,
				commitment.title,
				embedding,
			);

			trackAnalyticsEvent(workspaceId, userId, 'commitment.dedup_result', {
				result: dedupResult,
			});

			if (dedupResult === 'merge' || dedupResult === 'dismiss') {
				console.log(`[ai-extraction] Dedup ${dedupResult}`);
				continue;
			}

			// Compute source message age from the latest message timestamp (Feature 5)
			const lastTimestamp = messages[messages.length - 1]?.timestamp;
			const sourceMessageAgeDays = lastTimestamp
				? Math.round((Date.now() - new Date(lastTimestamp).getTime()) / 86400000)
				: undefined;

			// Store commitment with banditTraceId for feedback loop
			await createCommitment(
				workspaceId,
				{
					contactId,
					title: commitment.title,
					commitmentType: commitment.commitment_type,
					assignee: commitment.assignee,
					confidence: commitment.confidence,
					dueDate: commitment.due_date ? new Date(commitment.due_date) : undefined,
					quote: commitment.quote,
					sourceMessageIds: commitment.source_message_ids?.filter(isValidUuid),
					extractionContext,
					embedding,
					sourceMessageAgeDays,
					banditTraceId: traceId,
					status: localCommitmentMode ? 'draft' : undefined,
				},
				envelope,
			);

			stored++;

			trackAnalyticsEvent(workspaceId, userId, 'commitment.stored', {
				trace_id: traceId,
				confidence: commitment.confidence,
			});

			console.log(
				`[ai-extraction] Stored commitment (${dedupResult}, confidence=${commitment.confidence})`,
			);
		}

		// 3. Record feedback signals (non-fatal — loop closure)
		// SEC-001: Mask transcript before storage in golden_dataset (never store raw PII)
		const maskedTranscript = data.workspaceSalt
			? maskEntities(
					extractionContext,
					Buffer.from(data.workspaceSalt, 'hex'),
					prefilterEntities(extractionContext),
				).maskedText
			: '[masked — no salt available]';
		try {
			await recordExtractionFeedback({
				candidates: pass1Candidates,
				verified: extractedForStorage,
				transcript: maskedTranscript,
				traceId,
				variant,
				workspaceId,
			});
		} catch (err) {
			console.error(
				'[ai-extraction] Feedback signal recording failed (non-fatal):',
				redactSensitive(err),
			);
		}

		return { traceId, variant, stored };
	}),
	aiFlowWorkerOptions(aiExtractionWorkerConcurrency()),
);

/**
 * AI pipeline worker — embedding generation.
 * Generates vector embeddings for semantic search.
 *
 * CRITICAL: Entity-Linked Masking runs BEFORE embedding API calls.
 * Embeddings are invertible — raw PII must NEVER be embedded (ERR-003).
 */
export const embeddingsWorker = new Worker(
	'embeddings',
	withRLS(async (job) => {
		const data = job.data as JobData;
		const { contactId, workspaceId } = data;

		if (!(await requirePersistedAiConsent(data, 'ai-embeddings'))) {
			return { skipped: true, reason: 'no_ai_consent' };
		}

		if (!data.messages || data.messages.length === 0) {
			console.log(`[ai-embeddings] No messages to embed for contact=${contactId.slice(0, 8)}`);
			return;
		}

		const envelope = envelopeFromJob(data);
		if (!envelope) {
			console.log(`[ai-embeddings] No key envelope for contact=${contactId.slice(0, 8)}, skipping`);
			return;
		}

		if (!data.workspaceSalt) {
			console.error(
				`[ai-embeddings] Missing workspace salt for contact=${contactId.slice(0, 8)}, refusing to mask with weak fallback`,
			);
			return;
		}
		const salt = Buffer.from(data.workspaceSalt, 'hex');

		// Decrypt message content from BullMQ payload (SEC-006)
		const embWrk = await unwrapWrk(envelope);
		const embKeys = await deriveKeys(embWrk, workspaceId, envelope.wrkVersion);
		const messages = data.messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: decrypt(m.content, embKeys.dek),
			timestamp: m.timestamp,
		}));

		console.log(
			`[ai-embeddings] Generating embeddings for ${messages.length} messages for contact=${contactId.slice(0, 8)}`,
		);

		const maskedMessages = messages.map((msg) => {
			const detectedEntities = prefilterEntities(msg.content);
			const { maskedText } = maskEntities(msg.content, salt, detectedEntities);
			return { msg, maskedText };
		});
		const embeddings = await generateEmbeddingsCached(
			maskedMessages.map((item) => item.maskedText),
		);

		for (const result of embeddings) {
			const item = maskedMessages[result.index];
			if (!item) continue;
			const { msg, maskedText } = item;

			// 4. Store as memory
			await createMemory(
				workspaceId,
				{
					contactId,
					category: 'general',
					content: msg.content,
					contentSanitized: maskedText,
					embedding: result.embedding,
					metadata: msg.id
						? {
								messageId: msg.id,
								source: 'ai_embeddings_worker',
							}
						: {
								source: 'ai_embeddings_worker',
							},
				},
				envelope,
			);
		}

		console.log(
			`[ai-embeddings] Stored ${messages.length} memories for contact=${contactId.slice(0, 8)}`,
		);
	}),
	aiFlowWorkerOptions(3),
);

/**
 * AI pipeline worker — contact summary generation.
 * Uses bandit-integrated generation for Thompson Sampling style selection.
 * Entity-linked masking applied before message content reaches AI.
 */
export const summaryWorker = new Worker(
	'summaries',
	withRLS(async (job) => {
		const data = job.data as JobData;
		const { userId, contactId, workspaceId } = data;

		if (!(await requirePersistedAiConsent(data, 'ai-summary'))) {
			return { skipped: true, reason: 'no_ai_consent' };
		}

		if (!data.messages || data.messages.length === 0) {
			console.log(`[ai-summary] No messages to summarize for contact=${contactId.slice(0, 8)}`);
			return;
		}

		const envelope = envelopeFromJob(data);
		if (!envelope) {
			console.log(`[ai-summary] No key envelope for contact=${contactId.slice(0, 8)}, skipping`);
			return;
		}

		if (!data.workspaceSalt) {
			console.error(
				`[ai-summary] Missing workspace salt for contact=${contactId.slice(0, 8)}, refusing to mask with weak fallback`,
			);
			return;
		}
		const salt = Buffer.from(data.workspaceSalt, 'hex');

		// Decrypt message content from BullMQ payload (SEC-006)
		const sumWrk = await unwrapWrk(envelope);
		const sumKeys = await deriveKeys(sumWrk, workspaceId, envelope.wrkVersion);
		const decryptedMessages = data.messages.map((m) => ({
			role: m.role,
			content: decrypt(m.content, sumKeys.dek),
			timestamp: m.timestamp,
		}));

		console.log(
			`[ai-summary] Generating summary from ${decryptedMessages.length} messages for contact=${contactId.slice(0, 8)}`,
		);

		const result = await generateContactSummary(
			{
				contactId,
				contactName: 'Contact', // Name resolved at DAL level; masked here
				workspaceId,
				messages: decryptedMessages,
				commitmentsSummary: '',
				workspaceSalt: salt,
			},
			userId,
		);

		// Handle empty/very short responses
		if (!result.summary || result.summary.length < 50) {
			console.log(
				`[ai-summary] Summary too short (${result.summary.length} chars), marking failed`,
			);
			await upsertSummary(
				workspaceId,
				{
					contactId,
					summary: result.summary || '',
					model: result.model,
					messageCount: result.messageCount,
					status: 'failed',
					banditTraceId: result.traceId,
					styleVariant: result.variant,
				},
				envelope,
			);
			return { traceId: result.traceId, variant: result.variant, status: 'failed' };
		}

		await upsertSummary(
			workspaceId,
			{
				contactId,
				summary: result.summary,
				model: result.model,
				messageCount: result.messageCount,
				status: 'ready',
				banditTraceId: result.traceId,
				styleVariant: result.variant,
			},
			envelope,
		);

		console.log(
			`[ai-summary] Stored summary (variant=${result.variant}) for contact=${contactId.slice(0, 8)}`,
		);

		return { traceId: result.traceId, variant: result.variant, status: 'ready' };
	}),
	aiFlowWorkerOptions(3),
);

// Event logging
orchestratorWorker.on('completed', (job) => {
	console.log(`[ai-orchestrator] Job ${job.id} completed`);
});
orchestratorWorker.on('failed', (job, err) => {
	console.error(`[ai-orchestrator] Job ${job?.id} failed:`, redactSensitive(err));
	if (job?.data) {
		const d = job.data as JobData;
		trackAnalyticsEvent(d.workspaceId, d.userId, 'ai_pipeline.failed', {
			queue: 'orchestrator',
			error_type: redactSensitive(err.message?.split(':')[0] || 'unknown'),
		});
	}
});

extractionWorker.on('completed', (job) => {
	console.log(`[ai-extraction] Job ${job.id} completed`);
});
extractionWorker.on('failed', (job, err) => {
	console.error(`[ai-extraction] Job ${job?.id} failed:`, redactSensitive(err));
	if (job?.data) {
		const d = job.data as JobData;
		trackAnalyticsEvent(d.workspaceId, d.userId, 'ai_pipeline.failed', {
			queue: 'extraction',
			error_type: redactSensitive(err.message?.split(':')[0] || 'unknown'),
		});
	}
});

embeddingsWorker.on('completed', (job) => {
	console.log(`[ai-embeddings] Job ${job.id} completed`);
});
embeddingsWorker.on('failed', (job, err) => {
	console.error(`[ai-embeddings] Job ${job?.id} failed:`, redactSensitive(err));
});

summaryWorker.on('completed', (job) => {
	console.log(`[ai-summary] Job ${job.id} completed`);
});
summaryWorker.on('failed', (job, err) => {
	console.error(`[ai-summary] Job ${job?.id} failed:`, redactSensitive(err));
});

/**
 * AI pipeline worker — goal extraction (GI4).
 * Detects goals/objectives from messages, dedup via blind index,
 * stores as proposals for user confirmation.
 *
 * Security:
 * - SEC-006: Messages decrypted from BullMQ payload
 * - SEC-122: ELM masking on extracted goal titles before any external API
 * - Blind index dedup prevents re-proposing dismissed goals
 */
export const goalExtractionWorker = new Worker(
	'goal-extraction',
	withRLS(async (job) => {
		const data = job.data as JobData;
		const { userId, contactId, workspaceId } = data;

		if (!(await requirePersistedAiConsent(data, 'goal-extraction'))) {
			return { skipped: true, reason: 'no_ai_consent' };
		}

		if (!data.messages || data.messages.length === 0) {
			console.log(`[goal-extraction] No messages for contact=${contactId.slice(0, 8)}`);
			return;
		}

		const envelope = envelopeFromJob(data);
		if (!envelope) {
			console.log(
				`[goal-extraction] No key envelope for contact=${contactId.slice(0, 8)}, skipping`,
			);
			return;
		}

		// Decrypt messages from BullMQ payload (SEC-006)
		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
		const messages = data.messages.map((m) => ({
			role: m.role,
			content: decrypt(m.content, keys.dek),
			timestamp: m.timestamp,
		}));

		console.log(
			`[goal-extraction] Extracting goals from ${messages.length} messages for contact=${contactId.slice(0, 8)}`,
		);

		// Extract goals via Haiku
		const referenceTime = new Date().toISOString();
		const { goals: extracted } = await extractGoals(messages, referenceTime, keys.bik);

		if (extracted.length === 0) {
			console.log(`[goal-extraction] No goals found for contact=${contactId.slice(0, 8)}`);
			return { stored: 0 };
		}

		trackAnalyticsEvent(workspaceId, userId, 'goal.extracted', {
			count: extracted.length,
		});

		// Process each extracted goal: confidence filter → dedup → ELM → store proposal
		let stored = 0;
		for (const goal of extracted) {
			// Skip low-confidence extractions
			if (goal.confidence < 0.4) {
				console.log(`[goal-extraction] Skipping low confidence (${goal.confidence}) goal`);
				continue;
			}

			// Dedup via blind index — check if this goal title already exists
			const isDuplicate = await isDuplicateGoal(workspaceId, goal.title, envelope);
			if (isDuplicate) {
				console.log('[goal-extraction] Duplicate goal detected via blind index, skipping');
				continue;
			}

			// ELM enforcement: mask extracted title before logging (SEC-122)
			if (data.workspaceSalt) {
				const salt = Buffer.from(data.workspaceSalt, 'hex');
				const detectedEntities = prefilterEntities(goal.title);
				maskEntities(goal.title, salt, detectedEntities);
				// Masked title used only for logging — raw title stored encrypted in DB
			}

			// Store as proposal (user must confirm)
			await createGoalProposal(
				workspaceId,
				{
					type: goal.type,
					title: goal.title,
					description: goal.quote,
					targetDate: goal.target_date ? new Date(goal.target_date) : undefined,
				},
				envelope,
			);

			stored++;

			trackAnalyticsEvent(workspaceId, userId, 'goal.proposed', {
				type: goal.type,
				confidence: goal.confidence,
				has_deadline: !!goal.target_date,
			});

			console.log(
				`[goal-extraction] Stored goal proposal (type=${goal.type}, confidence=${goal.confidence})`,
			);
		}

		return { stored };
	}),
	aiFlowWorkerOptions(3),
);

goalExtractionWorker.on('completed', (job) => {
	console.log(`[goal-extraction] Job ${job.id} completed`);
});
goalExtractionWorker.on('failed', (job, err) => {
	console.error(`[goal-extraction] Job ${job?.id} failed:`, redactSensitive(err));
});
