import { boolean, jsonb, pgTable, real, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { pgVector } from './custom-types';
import { correctionSourceEnum, difficultyTierEnum, verificationStatusEnum } from './enums';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * Golden Dataset — curated input/output pairs for recursive learning.
 * Each example captures a model prediction, a corrected output,
 * and metadata used to select few-shot examples for prompt caching (Layer 2).
 */
export const goldenDataset = pgTable('golden_dataset', {
	id: uuid('id').defaultRandom().primaryKey(),
	workspaceId: uuid('workspace_id').references(() => workspaces.id),
	featureDomain: varchar('feature_domain', { length: 100 }).notNull(),
	inputContext: text('input_context').notNull(),
	/** Full-precision vector for accurate retrieval (accuracy > storage here) */
	inputEmbedding: pgVector('input_embedding'),
	modelPrediction: jsonb('model_prediction').notNull(),
	predictionMetadata: jsonb('prediction_metadata'),
	correctedOutput: jsonb('corrected_output').notNull(),
	correctionReasoning: text('correction_reasoning'),
	tags: text('tags').array(),
	difficulty: difficultyTierEnum('difficulty').default('standard'),
	source: correctionSourceEnum('source').default('user_edit'),
	status: verificationStatusEnum('status').default('pending'),
	verifiedBy: uuid('verified_by').references(() => users.id),
	verificationScore: real('verification_score'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	sourceInteractionId: uuid('source_interaction_id'),
	inputContextHash: text('input_context_hash'),
});

/**
 * Bandit Ledger — tracks Thompson Sampling trials for prompt variant selection.
 * Each row records one trial (prompt variant chosen + outcome reward).
 *
 * Alpha/Beta are computed on read via:
 *   alpha = 1 + SUM(reward_score) WHERE is_finalized = true
 *   beta  = 1 + (COUNT(*) - SUM(reward_score)) WHERE is_finalized = true
 */
export const banditLedger = pgTable('bandit_ledger', {
	traceId: uuid('trace_id').defaultRandom().primaryKey(),
	promptVariant: varchar('prompt_variant', { length: 50 }).notNull(),
	featureContext: varchar('feature_context', { length: 100 }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	rewardScore: real('reward_score').default(0.0),
	isFinalized: boolean('is_finalized').default(false),
	userId: uuid('user_id'),
	outcomeType: varchar('outcome_type', { length: 50 }),
});
