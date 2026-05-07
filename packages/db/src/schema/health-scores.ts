import { jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { workspaces } from './workspaces';

export const contactHealthScores = pgTable(
	'contact_health_scores',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		contactId: uuid('contact_id')
			.references(() => contacts.id)
			.notNull(),
		recency: real('recency').default(0).notNull(),
		frequency: real('frequency').default(0).notNull(),
		fulfillment: real('fulfillment').default(0).notNull(),
		responsiveness: real('responsiveness').default(0).notNull(),
		reciprocity: real('reciprocity').default(0).notNull(),
		depth: real('depth').default(0).notNull(),
		composite: real('composite').default(0).notNull(),
		label: text('label').default('dormant').notNull(),
		trend: text('trend').default('stable').notNull(),
		previousComposite: real('previous_composite'),
		computationData: jsonb('computation_data').default({}),
		computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		sharingLevel: text('sharing_level').default('private').notNull(),
	},
	(table) => [
		uniqueIndex('unique_health_score_per_contact').on(table.workspaceId, table.contactId),
	],
);
