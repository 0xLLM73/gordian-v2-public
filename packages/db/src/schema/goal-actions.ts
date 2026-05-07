import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { encryptedText } from './custom-types';
import {
	goalActionStatusEnum,
	goalActionTypeEnum,
	goalDomainTagEnum,
	goalEffortEnum,
} from './enums';
import { goals } from './goals';
import { workspaces } from './workspaces';

export const goalActions = pgTable(
	'goal_actions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		goalId: uuid('goal_id')
			.references(() => goals.id)
			.notNull(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		title: encryptedText('title').notNull(),
		description: encryptedText('description'),
		contactId: uuid('contact_id').references(() => contacts.id),
		status: goalActionStatusEnum('status').default('pending').notNull(),
		actionType: goalActionTypeEnum('action_type').notNull(),
		domainTag: goalDomainTagEnum('domain_tag').notNull(),
		effort: goalEffortEnum('effort').default('medium').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
	},
	(table) => [
		index('goal_actions_goal_id_idx').on(table.goalId),
		index('goal_actions_workspace_id_idx').on(table.workspaceId),
		index('goal_actions_contact_id_idx').on(table.contactId),
		index('goal_actions_status_idx').on(table.status),
	],
);
