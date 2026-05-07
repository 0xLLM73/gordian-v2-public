import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const featureFlags = pgTable(
	'feature_flags',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id').references(() => workspaces.id),
		key: text('key').notNull(),
		enabled: boolean('enabled').default(false).notNull(),
		metadata: jsonb('metadata').default({}),
		updatedBy: text('updated_by'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('feature_flags_key_idx').on(table.key),
		index('feature_flags_workspace_idx').on(table.workspaceId),
		uniqueIndex('feature_flags_key_workspace_uniq').on(table.key, table.workspaceId),
	],
);
