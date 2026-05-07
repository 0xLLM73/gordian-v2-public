import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const chatParticipants = pgTable(
	'chat_participants',
	{
		chatId: uuid('chat_id').notNull(),
		contactId: uuid('contact_id').notNull(),
		workspaceId: uuid('workspace_id')
			.references(() => workspaces.id)
			.notNull(),
		joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.chatId, table.contactId] }),
		index('chat_participants_workspace_id_idx').on(table.workspaceId),
	],
);
