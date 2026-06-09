import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';

export const messages = pgTable(
	'messages',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		workspaceId: uuid('workspace_id').notNull(),
		chatId: uuid('chat_id').notNull(),
		contactId: uuid('contact_id'),
		telegramMessageId: text('telegram_message_id').notNull(),
		telegramSenderId: text('telegram_sender_id'),
		telegramSenderType: text('telegram_sender_type'),
		text: encryptedText('text'),
		isOutgoing: boolean('is_outgoing').default(false).notNull(),
		sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('messages_workspace_chat_idx').on(table.workspaceId, table.chatId),
		index('messages_workspace_contact_idx').on(table.workspaceId, table.contactId),
		index('messages_workspace_sender_idx').on(table.workspaceId, table.telegramSenderId),
		index('messages_sent_at_idx').on(table.sentAt),
		uniqueIndex('messages_dedup_idx').on(table.workspaceId, table.chatId, table.telegramMessageId),
	],
);
