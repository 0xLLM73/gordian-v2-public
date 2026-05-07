import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { chatTypeEnum } from './enums';

export const chats = pgTable(
	'chats',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		workspaceId: uuid('workspace_id').notNull(),
		telegramChatId: text('telegram_chat_id').notNull(),
		type: chatTypeEnum('type').notNull().default('private'),
		title: encryptedText('title'),
		username: encryptedText('username'),
		participantCount: integer('participant_count'),
		isArchived: boolean('is_archived').default(false),
		lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('chats_workspace_telegram_idx').on(table.workspaceId, table.telegramChatId),
	],
);
