import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const userBehaviors = pgTable(
	'user_behaviors',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		userId: uuid('user_id').notNull(),
		event: text('event').notNull(),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('user_behaviors_workspace_created_idx').on(table.workspaceId, table.createdAt),
		index('user_behaviors_workspace_event_idx').on(table.workspaceId, table.event),
		index('user_behaviors_workspace_event_created_idx').on(
			table.workspaceId,
			table.event,
			table.createdAt,
		),
	],
);
