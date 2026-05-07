import { index, pgEnum, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { workspaces } from './workspaces';

export const recommendationTypeEnum = pgEnum('recommendation_type', [
	're_engage',
	'follow_up',
	'advance_deal',
	'make_intro',
	'achieve_goal',
]);

export const recommendationStatusEnum = pgEnum('recommendation_status', [
	'pending',
	'acted',
	'dismissed',
	'expired',
]);

/**
 * AI-generated action recommendations for the user.
 * Scored deterministically by the recommendations engine (no LLM).
 * Lifecycle: pending → acted | dismissed | expired.
 */
export const recommendations = pgTable(
	'recommendations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		/** Optional — null for workspace-level recommendations (e.g. digest) */
		contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
		type: recommendationTypeEnum('type').notNull(),
		/** 0.0–1.0 — higher means more urgent; adjusted by calibration boosts */
		priorityScore: real('priority_score').notNull(),
		/** Human-readable explanation — must not contain PII (contact names, handles) */
		reasoning: text('reasoning').notNull(),
		status: recommendationStatusEnum('status').notNull().default('pending'),
		/** When null the recommendation doesn't expire automatically */
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('recommendations_workspace_status_idx').on(table.workspaceId, table.status),
		index('recommendations_contact_idx').on(table.contactId),
		index('recommendations_expires_at_idx').on(table.expiresAt),
	],
);
