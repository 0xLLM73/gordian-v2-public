import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { encryptedText } from './custom-types';
import { chatTypeEnum } from './enums';

export const chats = pgTable(
	'chats',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		workspaceId: uuid('workspace_id').notNull(),
		telegramChatId: text('telegram_chat_id').notNull(),
		sourceAccountId: text('source_account_id'),
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
		index('chats_workspace_source_account_idx').on(table.workspaceId, table.sourceAccountId),
		uniqueIndex('chats_workspace_telegram_legacy_idx')
			.on(table.workspaceId, table.telegramChatId)
			.where(sql`${table.sourceAccountId} IS NULL`),
		uniqueIndex('chats_workspace_source_telegram_idx')
			.on(table.workspaceId, table.sourceAccountId, table.telegramChatId)
			.where(sql`${table.sourceAccountId} IS NOT NULL`),
	],
);
