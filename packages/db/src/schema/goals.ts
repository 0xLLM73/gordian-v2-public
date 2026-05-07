import { index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { blindIndex, encryptedText } from './custom-types';
import { goalProgressSourceEnum, goalStatusEnum, goalTypeEnum } from './enums';
import { workspaces } from './workspaces';

export type GoalRow = typeof goals.$inferSelect;

export const goals = pgTable(
	'goals',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		type: goalTypeEnum('type').notNull(),
		title: encryptedText('title').notNull(),
		description: encryptedText('description'),
		titleBlindIndex: blindIndex('title_blind_index'),
		targetCount: integer('target_count').notNull(),
		currentCount: integer('current_count').default(0).notNull(),
		contactId: uuid('contact_id').references(() => contacts.id),
		status: goalStatusEnum('status').default('active').notNull(),
		targetDate: timestamp('target_date', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
	},
	(table) => [
		index('goals_workspace_status_idx').on(table.workspaceId, table.status),
		index('goals_workspace_type_idx').on(table.workspaceId, table.type),
		index('goals_title_bidx_idx').on(table.titleBlindIndex),
	],
);

export const goalProgressEvents = pgTable(
	'goal_progress_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		goalId: uuid('goal_id')
			.references(() => goals.id, { onDelete: 'cascade' })
			.notNull(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		delta: integer('delta').notNull(),
		source: goalProgressSourceEnum('source').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('gpe_goal_idx').on(table.goalId),
		index('gpe_workspace_idx').on(table.workspaceId),
	],
);
