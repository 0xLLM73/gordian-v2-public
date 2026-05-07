import { z } from 'zod';

/**
 * Zod schemas for Phase 4 Intelligence Layer.
 * Used for runtime validation of job payloads, API responses, and pipeline data.
 */

/** Memory categories (matches memoryCategoryEnum in DB) */
export const memoryCategorySchema = z.enum([
	'general',
	'preference',
	'commitment',
	'relationship',
	'financial',
	'technical',
	'emotional',
	'temporal',
	'location',
	'organization',
	'project',
	'event',
	'communication_style',
	'decision_pattern',
	'risk_tolerance',
	'goal',
	'constraint',
	'expertise',
	'interest',
	'conflict',
	'agreement',
	'status_update',
	'context',
]);
export type MemoryCategory = z.infer<typeof memoryCategorySchema>;

/** Commitment type */
export const commitmentTypeSchema = z.enum(['promise', 'task', 'meeting', 'financial']);
export type CommitmentType = z.infer<typeof commitmentTypeSchema>;

/** Commitment status */
export const commitmentStatusSchema = z.enum(['active', 'completed', 'dismissed', 'draft']);
export type CommitmentStatus = z.infer<typeof commitmentStatusSchema>;

/** Summary status */
export const summaryStatusSchema = z.enum(['generating', 'ready', 'stale', 'failed']);
export type SummaryStatus = z.infer<typeof summaryStatusSchema>;

/** Deal stage (v2 pipeline — replaces dealStatusSchema) */
export const dealStageSchema = z.enum([
	'discovery',
	'diligence',
	'negotiation',
	'committed',
	'won',
	'lost',
]);
export type DealStage = z.infer<typeof dealStageSchema>;

/** Deal type */
export const dealTypeSchema = z.enum(['investment', 'advisory', 'partnership', 'token', 'other']);
export type DealType = z.infer<typeof dealTypeSchema>;

/** Deal source */
export const dealSourceSchema = z.enum(['manual', 'detected']);
export type DealSource = z.infer<typeof dealSourceSchema>;

/** Deal terms (flexible JSONB structure for crypto-specific instruments) */
export const dealTermsSchema = z
	.object({
		discount: z.number().min(0).max(100).optional(),
		valuationCap: z.number().nonnegative().optional(),
		vestingCliffMonths: z.number().int().nonnegative().optional(),
		vestingPeriodMonths: z.number().int().nonnegative().optional(),
		exercisePrice: z.number().nonnegative().optional(),
		tokenAllocation: z.number().nonnegative().optional(),
		proRataRights: z.boolean().optional(),
		notes: z.string().optional(),
	})
	.passthrough();
export type DealTerms = z.infer<typeof dealTermsSchema>;

/** Stage history entry for pipeline timeline */
export const stageHistoryEntrySchema = z.object({
	stage: dealStageSchema,
	timestamp: z.string(),
	note: z.string().optional(),
});
export type StageHistoryEntry = z.infer<typeof stageHistoryEntrySchema>;

/** Decision type */
export const decisionTypeSchema = z.enum([
	'message',
	'click',
	'view',
	'purchase',
	'commitment',
	'dismissal',
]);
export type DecisionType = z.infer<typeof decisionTypeSchema>;

/** Edge type */
export const edgeTypeSchema = z.enum([
	'explicit_reply',
	'implicit_context',
	'temporal',
	'semantic',
]);
export type EdgeType = z.infer<typeof edgeTypeSchema>;

/** Key envelope for job payloads — encrypted, NEVER plaintext */
export const keyEnvelopeSchema = z.object({
	encryptedWrk: z.string(),
	kmsContext: z.record(z.string(), z.string()),
	wrkVersion: z.number().int().positive(),
});
export type KeyEnvelope = z.infer<typeof keyEnvelopeSchema>;

/** AI pipeline job data */
export const aiPipelineJobSchema = z.object({
	userId: z.string().uuid(),
	contactId: z.string().uuid(),
	workspaceId: z.string().uuid(),
	keyEnvelope: keyEnvelopeSchema.optional(),
	messages: z
		.array(
			z.object({
				role: z.string(),
				content: z.string(),
				timestamp: z.string(),
			}),
		)
		.optional(),
	workspaceSalt: z.string().optional(),
});
export type AIPipelineJob = z.infer<typeof aiPipelineJobSchema>;

/** Extracted commitment (from LLM tool use) */
export const extractedCommitmentSchema = z.object({
	title: z.string().min(1),
	commitment_type: commitmentTypeSchema,
	assignee: z.string(),
	due_date: z.string().nullable().optional(),
	confidence: z.number().min(0).max(1),
	quote: z.string(),
	reasoning: z.string().optional(),
});
export type ExtractedCommitment = z.infer<typeof extractedCommitmentSchema>;

/** Embedding API response */
export const embeddingResponseSchema = z.object({
	data: z.array(
		z.object({
			embedding: z.array(z.number()),
			index: z.number(),
		}),
	),
});
export type EmbeddingResponse = z.infer<typeof embeddingResponseSchema>;

/** Hybrid search result */
export const hybridSearchResultSchema = z.object({
	id: z.string().uuid(),
	content: z.string(),
	category: memoryCategorySchema,
	rrf_score: z.number(),
	semantic_score: z.number(),
	fts_rank: z.number(),
});
export type HybridSearchResult = z.infer<typeof hybridSearchResultSchema>;

/** Dedup result */
export const dedupResultSchema = z.enum(['create', 'merge', 'flag', 'dismiss']);
export type DedupResult = z.infer<typeof dedupResultSchema>;

/** Correction source for golden dataset */
export const correctionSourceSchema = z.enum(['user_edit', 'expert_review', 'implicit_signal']);
export type CorrectionSource = z.infer<typeof correctionSourceSchema>;

/** Difficulty tier for golden examples */
export const difficultyTierSchema = z.enum(['trivial', 'standard', 'edge_case']);
export type DifficultyTier = z.infer<typeof difficultyTierSchema>;

/** Verification status for golden examples */
export const verificationStatusSchema = z.enum(['pending', 'verified', 'rejected']);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

/** Golden dataset example */
export const goldenExampleSchema = z.object({
	featureDomain: z.string().min(1).max(100),
	inputContext: z.string().min(1),
	modelPrediction: z.unknown(),
	predictionMetadata: z.unknown().optional(),
	correctedOutput: z.unknown(),
	correctionReasoning: z.string().optional(),
	tags: z.array(z.string()).optional(),
	difficulty: difficultyTierSchema.optional(),
	source: correctionSourceSchema.optional(),
	verificationScore: z.number().min(0).max(1).optional(),
	sourceInteractionId: z.string().uuid().optional(),
});
export type GoldenExample = z.infer<typeof goldenExampleSchema>;

/** Bandit trial record */
export const banditTrialSchema = z.object({
	traceId: z.string().uuid(),
	promptVariant: z.string().min(1).max(50),
	featureContext: z.string().max(100).optional(),
	rewardScore: z.number().min(0).max(1).optional(),
	userId: z.string().uuid().optional(),
	outcomeType: z.string().max(50).optional(),
});
export type BanditTrial = z.infer<typeof banditTrialSchema>;

/** Contact relationship type */
export const contactRelationshipSchema = z.enum([
	'friend',
	'colleague',
	'prospect',
	'client',
	'investor',
	'family',
	'mentor',
	'mentee',
	'partner',
	'vendor',
	'other',
]);
export type ContactRelationship = z.infer<typeof contactRelationshipSchema>;

/** Contact priority */
export const contactPrioritySchema = z.enum(['high', 'medium', 'low']);
export type ContactPriority = z.infer<typeof contactPrioritySchema>;

/** Contact status */
export const contactStatusSchema = z.enum(['active', 'nurturing', 'dormant', 'new']);
export type ContactStatus = z.infer<typeof contactStatusSchema>;

/** Upsert contact tag input */
export const upsertContactTagSchema = z.object({
	contactId: z.string().uuid(),
	workspaceId: z.string().uuid(),
	relationship: contactRelationshipSchema.optional(),
	priority: contactPrioritySchema.optional(),
	status: contactStatusSchema.optional(),
	customTags: z.array(z.string()).optional(),
	goal: z.string().optional(),
	notes: z.string().optional(),
});
export type UpsertContactTag = z.infer<typeof upsertContactTagSchema>;

/** Digest focus preference */
export const digestFocusSchema = z.enum([
	'balanced',
	'commitments',
	'relationships',
	'deals',
	'network',
]);
export type DigestFocus = z.infer<typeof digestFocusSchema>;

/** Digest status */
export const digestStatusSchema = z.enum(['generating', 'ready', 'failed']);
export type DigestStatus = z.infer<typeof digestStatusSchema>;

/** Digest period */
export const digestPeriodSchema = z.enum(['today', 'yesterday', '3d', 'week', 'custom']);
export type DigestPeriod = z.infer<typeof digestPeriodSchema>;

/** Digest sections (structured AI output) */
export const digestSectionsSchema = z.object({
	activity_overview: z
		.object({
			summary: z.string(),
			message_count: z.number(),
			active_conversations: z.number(),
			new_contacts: z.number().optional(),
		})
		.optional(),
	highlights: z
		.array(
			z.object({
				title: z.string(),
				detail: z.string(),
				contact_ref: z.string().optional(),
			}),
		)
		.optional(),
	key_conversations: z
		.array(
			z.object({
				contact_ref: z.string(),
				summary: z.string(),
				sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
			}),
		)
		.optional(),
	action_items: z
		.array(
			z.object({
				item: z.string(),
				priority: z.enum(['high', 'medium', 'low']),
				contact_ref: z.string().optional(),
			}),
		)
		.optional(),
	watch_list: z
		.array(
			z.object({
				contact_ref: z.string(),
				reason: z.string(),
			}),
		)
		.optional(),
});
export type DigestSections = z.infer<typeof digestSectionsSchema>;

/** Brief day of week */
export const briefDaySchema = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type BriefDay = z.infer<typeof briefDaySchema>;

/** User preferences for briefs and digest */
export const userPreferencesSchema = z.object({
	timezone: z.string().min(1).max(50),
	briefEnabled: z.boolean(),
	briefTime: z.number().int().min(0).max(23),
	briefDays: z.array(briefDaySchema).min(0).max(7),
	digestFocus: digestFocusSchema,
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

// ─── Calibration Schemas (Phase 29) ──────────────────────────────────────────

export const communicationStyleSchema = z.enum(['formal', 'casual', 'direct', 'diplomatic']);
export type CommunicationStyle = z.infer<typeof communicationStyleSchema>;

export const riskToleranceSchema = z.enum(['conservative', 'moderate', 'aggressive']);
export type RiskTolerance = z.infer<typeof riskToleranceSchema>;

export const detailPreferenceSchema = z.enum(['high_level', 'balanced', 'granular']);
export type DetailPreference = z.infer<typeof detailPreferenceSchema>;

export const relationshipFocusSchema = z.enum(['breadth', 'balanced', 'depth']);
export type RelationshipFocus = z.infer<typeof relationshipFocusSchema>;

export const decisionSpeedSchema = z.enum(['deliberate', 'moderate', 'fast']);
export type DecisionSpeed = z.infer<typeof decisionSpeedSchema>;

export const industryFocusOptions = [
	'defi',
	'infrastructure',
	'gaming',
	'ai',
	'social',
	'nft',
	'dao',
	'privacy',
	'payments',
	'security',
	'data',
	'identity',
	'rwa',
	'other',
] as const;

export const priorityOptions = [
	'deal_flow',
	'relationship_building',
	'market_intelligence',
	'portfolio_support',
	'networking',
] as const;

export const industryFocusSchema = z.enum(industryFocusOptions);
export const prioritySchema = z.enum(priorityOptions);

/** Step 1: Role & Focus */
export const calibrationStep1Schema = z.object({
	roleDescription: z.string().min(10).max(500),
	industryFocus: z.array(industryFocusSchema).min(1).max(5),
});

/** Step 2: Communication Style */
export const calibrationStep2Schema = z.object({
	communicationStyle: communicationStyleSchema,
	detailPreference: detailPreferenceSchema,
});

/** Step 3: Decision Making */
export const calibrationStep3Schema = z.object({
	riskTolerance: riskToleranceSchema,
	decisionSpeed: decisionSpeedSchema,
});

/** Step 4: Relationship Strategy */
export const calibrationStep4Schema = z.object({
	relationshipFocus: relationshipFocusSchema,
	priorities: z.array(prioritySchema).min(1).max(3),
});

/** Step 5: Investment Profile (optional) */
export const calibrationStep5Schema = z
	.object({
		investmentThesis: z.string().max(1000).optional(),
		ticketSizeMin: z.number().int().positive().optional(),
		ticketSizeMax: z.number().int().positive().optional(),
	})
	.refine(
		(data) => {
			if (data.ticketSizeMin && data.ticketSizeMax) {
				return data.ticketSizeMax >= data.ticketSizeMin;
			}
			return true;
		},
		{ message: 'Maximum ticket size must be >= minimum', path: ['ticketSizeMax'] },
	);

/** Full calibration input (for upsert) */
export const calibrationInputSchema = z.object({
	communicationStyle: communicationStyleSchema,
	detailPreference: detailPreferenceSchema,
	riskTolerance: riskToleranceSchema,
	decisionSpeed: decisionSpeedSchema,
	relationshipFocus: relationshipFocusSchema,
	priorities: z.array(prioritySchema).min(1).max(3),
	industryFocus: z.array(industryFocusSchema).min(1).max(5),
	roleDescription: z.string().min(10).max(500),
	investmentThesis: z.string().max(1000).optional(),
	ticketSizeMin: z.number().int().positive().optional(),
	ticketSizeMax: z.number().int().positive().optional(),
});
export type CalibrationInput = z.infer<typeof calibrationInputSchema>;
