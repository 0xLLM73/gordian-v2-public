import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { users } from './users';
import { workspaces } from './workspaces';

export const contactHealthFeedback = pgTable(
	'contact_health_feedback',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		contactId: uuid('contact_id')
			.references(() => contacts.id)
			.notNull(),
		userId: uuid('user_id').references(() => users.id),
		action: text('action').notNull(),
		reason: text('reason').notNull(),
		statusReasonCode: text('status_reason_code'),
		snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
		metadata: jsonb('metadata').default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('contact_health_feedback_workspace_contact_idx').on(table.workspaceId, table.contactId),
		index('contact_health_feedback_workspace_action_idx').on(table.workspaceId, table.action),
		index('contact_health_feedback_snoozed_until_idx').on(table.snoozedUntil),
	],
);
