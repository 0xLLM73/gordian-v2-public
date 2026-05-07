import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { contacts } from './contacts';
import { users } from './users';
import { workspaces } from './workspaces';

export const contactShares = pgTable(
	'contact_shares',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		contactId: uuid('contact_id')
			.references(() => contacts.id, { onDelete: 'cascade' })
			.notNull(),
		sharedWithUserId: uuid('shared_with_user_id')
			.references(() => users.id, { onDelete: 'cascade' })
			.notNull(),
		sharedByUserId: uuid('shared_by_user_id')
			.references(() => users.id)
			.notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('contact_shares_uniq').on(
			table.workspaceId,
			table.contactId,
			table.sharedWithUserId,
		),
		index('contact_shares_workspace_idx').on(table.workspaceId),
		index('contact_shares_shared_with_idx').on(table.sharedWithUserId),
		index('contact_shares_contact_idx').on(table.contactId),
	],
);
