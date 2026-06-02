import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { chats } from './chats';
import { chatTypeEnum } from './enums';
import { users } from './users';
import { workspaces } from './workspaces';

export const telegramImportRunStatusEnum = pgEnum('telegram_import_run_status', [
	'queued',
	'discovering',
	'importing',
	'pausing',
	'paused',
	'cancelling',
	'cancelled',
	'completed',
	'failed',
]);

export const telegramImportChatStatusEnum = pgEnum('telegram_import_chat_status', [
	'queued',
	'importing',
	'paused',
	'completed',
	'skipped',
	'failed',
	'cancelled',
]);

export const telegramImportScopeEnum = pgEnum('telegram_import_scope', ['all_private_and_groups']);

export const telegramImportRuns = pgTable(
	'telegram_import_runs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		sourceAccountId: text('source_account_id').notNull(),
		scope: telegramImportScopeEnum('scope').notNull().default('all_private_and_groups'),
		includePrivate: boolean('include_private').notNull().default(true),
		includeGroups: boolean('include_groups').notNull().default(true),
		includeChannels: boolean('include_channels').notNull().default(false),
		aiProcessingEnabled: boolean('ai_processing_enabled').notNull().default(false),
		status: telegramImportRunStatusEnum('status').notNull().default('queued'),
		idempotencyKey: text('idempotency_key').notNull(),
		totalDialogs: integer('total_dialogs').notNull().default(0),
		eligibleDialogs: integer('eligible_dialogs').notNull().default(0),
		skippedDialogs: integer('skipped_dialogs').notNull().default(0),
		chatsQueued: integer('chats_queued').notNull().default(0),
		chatsCompleted: integer('chats_completed').notNull().default(0),
		chatsFailed: integer('chats_failed').notNull().default(0),
		messagesSeen: integer('messages_seen').notNull().default(0),
		messagesInserted: integer('messages_inserted').notNull().default(0),
		duplicateMessages: integer('duplicate_messages').notNull().default(0),
		pagesFetched: integer('pages_fetched').notNull().default(0),
		requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
		startedAt: timestamp('started_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		pausedAt: timestamp('paused_at', { withTimezone: true }),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		failedAt: timestamp('failed_at', { withTimezone: true }),
		lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
		errorCode: text('error_code'),
		errorMessage: text('error_message'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('telegram_import_runs_workspace_status_idx').on(table.workspaceId, table.status),
		index('telegram_import_runs_user_status_idx').on(table.userId, table.status),
		uniqueIndex('telegram_import_runs_idempotency_idx').on(
			table.workspaceId,
			table.userId,
			table.sourceAccountId,
			table.idempotencyKey,
		),
	],
);

export const telegramImportRunChats = pgTable(
	'telegram_import_run_chats',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		importRunId: uuid('import_run_id')
			.notNull()
			.references(() => telegramImportRuns.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		sourceAccountId: text('source_account_id').notNull(),
		chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
		telegramChatId: text('telegram_chat_id').notNull(),
		chatType: chatTypeEnum('chat_type').notNull(),
		status: telegramImportChatStatusEnum('status').notNull().default('queued'),
		skipReason: text('skip_reason'),
		telegramTopMessageId: integer('telegram_top_message_id'),
		nextOffsetMessageId: integer('next_offset_message_id').notNull().default(0),
		oldestImportedMessageId: integer('oldest_imported_message_id'),
		newestImportedMessageId: integer('newest_imported_message_id'),
		pagesFetched: integer('pages_fetched').notNull().default(0),
		messagesSeen: integer('messages_seen').notNull().default(0),
		messagesInserted: integer('messages_inserted').notNull().default(0),
		duplicateMessages: integer('duplicate_messages').notNull().default(0),
		rateLimitUntil: timestamp('rate_limit_until', { withTimezone: true }),
		errorCode: text('error_code'),
		errorMessage: text('error_message'),
		startedAt: timestamp('started_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('telegram_import_run_chats_run_status_idx').on(table.importRunId, table.status),
		index('telegram_import_run_chats_workspace_source_idx').on(
			table.workspaceId,
			table.sourceAccountId,
		),
		unique('telegram_import_run_chats_unique_dialog').on(table.importRunId, table.telegramChatId),
	],
);

export const telegramChatImportState = pgTable(
	'telegram_chat_import_state',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		sourceAccountId: text('source_account_id').notNull(),
		chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
		telegramChatId: text('telegram_chat_id').notNull(),
		chatType: chatTypeEnum('chat_type').notNull(),
		historyComplete: boolean('history_complete').notNull().default(false),
		nextOffsetMessageId: integer('next_offset_message_id').notNull().default(0),
		oldestImportedMessageId: integer('oldest_imported_message_id'),
		newestImportedMessageId: integer('newest_imported_message_id'),
		lastImportRunId: uuid('last_import_run_id').references(() => telegramImportRuns.id, {
			onDelete: 'set null',
		}),
		lastImportedAt: timestamp('last_imported_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('telegram_chat_import_state_workspace_source_idx').on(
			table.workspaceId,
			table.sourceAccountId,
		),
		uniqueIndex('telegram_chat_import_state_unique_dialog').on(
			table.workspaceId,
			table.sourceAccountId,
			table.telegramChatId,
		),
	],
);

export type TelegramImportRun = typeof telegramImportRuns.$inferSelect;
export type TelegramImportRunChat = typeof telegramImportRunChats.$inferSelect;
export type TelegramChatImportState = typeof telegramChatImportState.$inferSelect;
