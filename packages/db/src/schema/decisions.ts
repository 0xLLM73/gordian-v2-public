import { index, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encryptedText, pgVector } from './custom-types';
import { decisionTypeEnum, edgeTypeEnum } from './enums';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * Decision graph schema (followup8):
 * user_decisions + causal_edges form a directed graph
 * for causal intelligence and GraphRAG search.
 */

export const userDecisions = pgTable('user_decisions', {
	id: uuid('id').primaryKey().defaultRandom(),
	workspaceId: uuid('workspace_id')
		.references(() => workspaces.id)
		.notNull(),
	userId: uuid('user_id')
		.references(() => users.id)
		.notNull(),
	rawContent: encryptedText('raw_content').notNull(),
	/** Full vector(1536) — not halfvec — for graph operations */
	embedding: pgVector('embedding'),
	decisionType: decisionTypeEnum('decision_type').notNull(),
	interactionMetadata: jsonb('interaction_metadata').default({}),
	/** Optional link to the entity (deal, commitment, etc.) this decision concerns */
	entityId: text('entity_id'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const causalEdges = pgTable(
	'causal_edges',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		sourceId: uuid('source_id')
			.references(() => userDecisions.id)
			.notNull(),
		targetId: uuid('target_id')
			.references(() => userDecisions.id)
			.notNull(),
		weight: real('weight').default(0.5).notNull(),
		edgeType: edgeTypeEnum('edge_type').notNull(),
		confidenceScore: real('confidence_score').default(0.5).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('causal_edges_source_idx').on(table.sourceId),
		index('causal_edges_target_idx').on(table.targetId),
		index('causal_edges_workspace_idx').on(table.workspaceId),
	],
);
