import { createHash } from 'node:crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { getCurrentKeys, maskEntities, prefilterEntities, withKeys } from '@repo/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { banditLedger, goldenDataset } from '../schema/golden-dataset';

export interface CreateGoldenExampleInput {
	workspaceId: string;
	featureDomain: string;
	inputContext: string;
	inputEmbedding?: number[];
	modelPrediction: unknown;
	predictionMetadata?: unknown;
	correctedOutput: unknown;
	correctionReasoning?: string;
	tags?: string[];
	difficulty?: 'trivial' | 'standard' | 'edge_case';
	source?: 'user_edit' | 'expert_review' | 'implicit_signal';
	verifiedBy?: string;
	verificationScore?: number;
	sourceInteractionId?: string;
}

const COMMITMENT_EXTRACTION_DOMAINS = new Set([
	'commitment_extraction',
	'seed_commitment_extraction',
]);

const COMMITMENT_TEXT_FIELDS = new Set([
	'content',
	'description',
	'explanation',
	'extractioncontext',
	'inputcontext',
	'message',
	'messages',
	'quote',
	'rationale',
	'raw',
	'rawtext',
	'reasoning',
	'sourcequote',
	'sourcetext',
	'text',
	'title',
	'transcript',
]);

function isCommitmentExtractionDomain(featureDomain: string): boolean {
	return COMMITMENT_EXTRACTION_DOMAINS.has(featureDomain);
}

function normalizeJsonKey(key: string): string {
	return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function shouldRedactCommitmentField(key: string): boolean {
	return COMMITMENT_TEXT_FIELDS.has(normalizeJsonKey(key));
}

function createScopedCommitmentTextRedactor() {
	const replacements = new Map<string, string>();
	return (value: string): string => {
		if (value.trim().length === 0) return value;
		const existing = replacements.get(value);
		if (existing) return existing;
		const replacement = `[COMMITMENT_TEXT_${replacements.size + 1}]`;
		replacements.set(value, replacement);
		return replacement;
	};
}

function sanitizeCommitmentJsonValue(
	value: unknown,
	redact: (value: string) => string,
	forceRedactStrings = false,
): unknown {
	if (typeof value === 'string') {
		return forceRedactStrings ? redact(value) : value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => sanitizeCommitmentJsonValue(item, redact, forceRedactStrings));
	}

	if (!value || typeof value !== 'object') {
		return value;
	}

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
			key,
			sanitizeCommitmentJsonValue(
				childValue,
				redact,
				forceRedactStrings || shouldRedactCommitmentField(key),
			),
		]),
	);
}

function sanitizeCommitmentExtractionPayload(
	modelPrediction: unknown,
	correctedOutput: unknown,
): { modelPrediction: unknown; correctedOutput: unknown } {
	const redact = createScopedCommitmentTextRedactor();
	return {
		modelPrediction:
			typeof modelPrediction === 'string'
				? redact(modelPrediction)
				: sanitizeCommitmentJsonValue(modelPrediction, redact),
		correctedOutput:
			typeof correctedOutput === 'string'
				? redact(correctedOutput)
				: sanitizeCommitmentJsonValue(correctedOutput, redact),
	};
}

/**
 * Create a golden dataset example with optional Entity-Linked Masking.
 * SEC-ENC-103: When envelope is provided, inputContext is masked BEFORE storage
 * to remove PII while preserving semantic structure for ML training.
 */
export async function createGoldenExample(
	input: CreateGoldenExampleInput,
	envelope?: SealedEnvelope,
) {
	let maskedContext = input.inputContext;
	const payload = isCommitmentExtractionDomain(input.featureDomain)
		? sanitizeCommitmentExtractionPayload(input.modelPrediction, input.correctedOutput)
		: {
				modelPrediction: input.modelPrediction,
				correctedOutput: input.correctedOutput,
			};

	if (envelope && input.inputContext) {
		maskedContext = await withKeys(envelope, async () => {
			const keys = getCurrentKeys();
			const detected = prefilterEntities(input.inputContext);
			const { maskedText } = maskEntities(input.inputContext, keys.bik, detected);
			return maskedText;
		});
	}

	const result = await db
		.insert(goldenDataset)
		.values({
			workspaceId: input.workspaceId,
			featureDomain: input.featureDomain,
			inputContext: maskedContext,
			inputEmbedding: input.inputEmbedding,
			modelPrediction: payload.modelPrediction,
			predictionMetadata: input.predictionMetadata,
			correctedOutput: payload.correctedOutput,
			correctionReasoning: input.correctionReasoning,
			tags: input.tags,
			difficulty: input.difficulty,
			source: input.source,
			verifiedBy: input.verifiedBy,
			verificationScore: input.verificationScore,
			sourceInteractionId: input.sourceInteractionId,
			inputContextHash: hashInputContext(maskedContext),
		})
		.returning();
	return result[0] ?? null;
}

/**
 * Find similar golden examples by vector similarity.
 * Uses cosine distance (<=> operator) on full-precision pgvector column.
 */
export async function findSimilarExamples(embedding: number[], featureDomain: string, limit = 10) {
	const embeddingStr = `[${embedding.join(',')}]`;

	const result = await db.execute(sql`
		SELECT id, feature_domain, input_context, model_prediction,
			   corrected_output, correction_reasoning, tags, difficulty,
			   1 - (input_embedding <=> ${embeddingStr}::vector(1536)) AS similarity
		FROM golden_dataset
		WHERE feature_domain = ${featureDomain}
		  AND status = 'verified'
		  AND input_embedding IS NOT NULL
		ORDER BY input_embedding <=> ${embeddingStr}::vector(1536)
		LIMIT ${limit}
	`);

	return result as unknown as Array<{
		id: string;
		feature_domain: string;
		input_context: string;
		model_prediction: unknown;
		corrected_output: unknown;
		correction_reasoning: string | null;
		tags: string[] | null;
		difficulty: string;
		similarity: number;
	}>;
}

/**
 * Get the golden library (top verified examples) for a feature domain.
 * Used as Layer 2 in the inverted pyramid prompt cache.
 */
export async function getGoldenLibrary(featureDomain: string, limit = 50, workspaceId?: string) {
	const conditions = [
		eq(goldenDataset.featureDomain, featureDomain),
		eq(goldenDataset.status, 'verified'),
	];
	if (workspaceId) {
		conditions.push(eq(goldenDataset.workspaceId, workspaceId));
	}
	return db
		.select()
		.from(goldenDataset)
		.where(and(...conditions))
		.orderBy(goldenDataset.verificationScore)
		.limit(limit);
}

export interface RecordBanditTrialInput {
	traceId: string;
	variant: string;
	featureContext?: string;
	userId?: string;
}

/**
 * Record a new bandit trial (prompt variant was selected).
 * Reward is finalized later via finalizeBanditReward().
 */
export async function recordBanditTrial(input: RecordBanditTrialInput) {
	const result = await db
		.insert(banditLedger)
		.values({
			traceId: input.traceId,
			promptVariant: input.variant,
			featureContext: input.featureContext,
			userId: input.userId,
		})
		.returning();
	return result[0] ?? null;
}

/**
 * Finalize a bandit trial with the observed reward score.
 */
export async function finalizeBanditReward(traceId: string, rewardScore: number) {
	const result = await db
		.update(banditLedger)
		.set({
			rewardScore,
			isFinalized: true,
		})
		.where(eq(banditLedger.traceId, traceId))
		.returning();
	return result[0] ?? null;
}

export interface BanditStats {
	promptVariant: string;
	alphaScore: number;
	betaScore: number;
}

/**
 * Get Thompson Sampling statistics for all prompt variants.
 * Computes alpha (1 + successes) and beta (1 + failures) over last 90 days.
 */
export async function getBanditStats(userId?: string): Promise<BanditStats[]> {
	const result = await db.execute(
		userId
			? sql`
		SELECT
			prompt_variant,
			1 + COALESCE(SUM(reward_score), 0) AS alpha_score,
			1 + (COUNT(*) - COALESCE(SUM(reward_score), 0)) AS beta_score
		FROM bandit_ledger
		WHERE is_finalized = true
		  AND created_at > NOW() - INTERVAL '90 days'
		  AND user_id = ${userId}::uuid
		GROUP BY prompt_variant
	`
			: sql`
		SELECT
			prompt_variant,
			1 + COALESCE(SUM(reward_score), 0) AS alpha_score,
			1 + (COUNT(*) - COALESCE(SUM(reward_score), 0)) AS beta_score
		FROM bandit_ledger
		WHERE is_finalized = true
		  AND created_at > NOW() - INTERVAL '90 days'
		GROUP BY prompt_variant
	`,
	);

	return (
		result as unknown as Array<{
			prompt_variant: string;
			alpha_score: number;
			beta_score: number;
		}>
	).map((row) => ({
		promptVariant: row.prompt_variant,
		alphaScore: Number(row.alpha_score),
		betaScore: Number(row.beta_score),
	}));
}

/**
 * Age-bucketed stats for temporal decay on Thompson Sampling priors.
 * Each bucket contributes separate alpha/beta values that can be
 * decayed by age before summing into final Beta distribution params.
 */
export interface BanditBucketedStats {
	promptVariant: string;
	/** Age bucket midpoint in days (3.5, 10.5, 22, 45) */
	bucketMidpointDays: number;
	/** SUM(reward_score) in this bucket — alpha contribution */
	successes: number;
	/** COUNT(*) - SUM(reward_score) in this bucket — beta contribution */
	failures: number;
}

/**
 * Get age-bucketed Thompson Sampling stats for temporal decay.
 * Buckets: 0-7d, 7-14d, 14-30d, 30-90d.
 * The caller applies exponential decay per bucket midpoint.
 */
export async function getBanditStatsBucketed(userId?: string): Promise<BanditBucketedStats[]> {
	const userFilter = userId ? sql`AND user_id = ${userId}::uuid` : sql``;

	const result = await db.execute(sql`
		SELECT
			prompt_variant,
			CASE
				WHEN created_at > NOW() - INTERVAL '7 days' THEN 3.5
				WHEN created_at > NOW() - INTERVAL '14 days' THEN 10.5
				WHEN created_at > NOW() - INTERVAL '30 days' THEN 22.0
				ELSE 45.0
			END AS bucket_midpoint_days,
			COALESCE(SUM(reward_score), 0) AS successes,
			COUNT(*) - COALESCE(SUM(reward_score), 0) AS failures
		FROM bandit_ledger
		WHERE is_finalized = true
		  AND created_at > NOW() - INTERVAL '90 days'
		  ${userFilter}
		GROUP BY prompt_variant, bucket_midpoint_days
	`);

	return (
		result as unknown as Array<{
			prompt_variant: string;
			bucket_midpoint_days: number;
			successes: number;
			failures: number;
		}>
	).map((row) => ({
		promptVariant: row.prompt_variant,
		bucketMidpointDays: Number(row.bucket_midpoint_days),
		successes: Number(row.successes),
		failures: Number(row.failures),
	}));
}

// ─── Gold Owner Protocol ──────────────────────────────────────────────────────

/**
 * SHA-256 hash of input context for contamination guard.
 */
export function hashInputContext(inputContext: string): string {
	return createHash('sha256').update(inputContext).digest('hex');
}

/**
 * List Silver-tier examples (status=pending) for human review.
 * SEC-006: input_context excluded — unnecessary exposure to web client.
 */
export async function listPendingExamples(
	workspaceId: string,
	featureDomain?: string,
	limit = 50,
	offset = 0,
) {
	const domainFilter = featureDomain ? sql`AND feature_domain = ${featureDomain}` : sql``;

	const rows = await db.execute(sql`
		SELECT id, feature_domain, model_prediction,
			   corrected_output, correction_reasoning, tags, difficulty,
			   source, created_at
		FROM golden_dataset
		WHERE status = 'pending'
		  AND workspace_id = ${workspaceId}::uuid
		  ${domainFilter}
		ORDER BY created_at DESC
		LIMIT ${limit} OFFSET ${offset}
	`);

	return rows as unknown as Array<{
		id: string;
		feature_domain: string;
		model_prediction: unknown;
		corrected_output: unknown;
		correction_reasoning: string | null;
		tags: string[] | null;
		difficulty: string;
		source: string;
		created_at: string;
	}>;
}

/**
 * Promote a pending example to Gold (verified) status.
 * SEC-005: workspaceId prevents IDOR — only workspace-owned examples can be promoted.
 */
export async function promoteToGold(
	goldenId: string,
	verifiedBy: string,
	verificationScore: number | undefined,
	workspaceId: string,
) {
	const conditions = [
		eq(goldenDataset.id, goldenId),
		eq(goldenDataset.status, 'pending'),
		eq(goldenDataset.workspaceId, workspaceId),
	];
	const result = await db
		.update(goldenDataset)
		.set({
			status: 'verified',
			verifiedBy,
			verificationScore: verificationScore ?? null,
		})
		.where(and(...conditions))
		.returning();
	return result[0] ?? null;
}

/**
 * Reject a pending example.
 * SEC-005: workspaceId prevents IDOR — only workspace-owned examples can be rejected.
 */
export async function rejectExample(goldenId: string, verifiedBy: string, workspaceId: string) {
	const conditions = [
		eq(goldenDataset.id, goldenId),
		eq(goldenDataset.status, 'pending'),
		eq(goldenDataset.workspaceId, workspaceId),
	];
	const result = await db
		.update(goldenDataset)
		.set({
			status: 'rejected',
			verifiedBy,
		})
		.where(and(...conditions))
		.returning();
	return result[0] ?? null;
}

/**
 * Check if an input context hash already exists in verified set (contamination guard).
 */
export async function isContaminated(inputContextHash: string): Promise<boolean> {
	const rows = await db.execute(sql`
		SELECT 1 FROM golden_dataset
		WHERE input_context_hash = ${inputContextHash}
		  AND status = 'verified'
		LIMIT 1
	`);
	return (rows as unknown as Array<unknown>).length > 0;
}

/**
 * Get review queue statistics (counts by status).
 */
export async function getReviewQueueStats(workspaceId?: string) {
	const workspaceFilter = workspaceId ? sql`WHERE workspace_id = ${workspaceId}::uuid` : sql``;

	const rows = await db.execute(sql`
		SELECT status, count(*)::int AS count
		FROM golden_dataset
		${workspaceFilter}
		GROUP BY status
	`);

	const stats: Record<string, number> = { pending: 0, verified: 0, rejected: 0 };
	for (const row of rows as unknown as Array<{ status: string; count: number }>) {
		stats[row.status] = row.count;
	}
	return stats;
}
