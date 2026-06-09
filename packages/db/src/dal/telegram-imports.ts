import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../client';
import { userCalibrations } from '../schema/calibration';
import { messages } from '../schema/messages';
import {
	telegramChatImportState,
	telegramImportRunChats,
	telegramImportRuns,
} from '../schema/telegram-imports';

export type TelegramImportRun = typeof telegramImportRuns.$inferSelect;
export type TelegramImportRunChat = typeof telegramImportRunChats.$inferSelect;
export type TelegramChatImportState = typeof telegramChatImportState.$inferSelect;
export type TelegramImportRunStatus = TelegramImportRun['status'];
export type TelegramImportChatStatus = TelegramImportRunChat['status'];

export const TELEGRAM_IMPORT_ACTIVE_STATUSES = [
	'queued',
	'discovering',
	'importing',
	'pausing',
	'paused',
	'cancelling',
] as const satisfies readonly TelegramImportRunStatus[];

export const TELEGRAM_IMPORT_TERMINAL_STATUSES = [
	'cancelled',
	'completed',
	'failed',
] as const satisfies readonly TelegramImportRunStatus[];

export const TELEGRAM_IMPORT_CHAT_TERMINAL_STATUSES = [
	'completed',
	'skipped',
	'failed',
	'cancelled',
] as const satisfies readonly TelegramImportChatStatus[];

export interface CreateTelegramImportRunInput {
	workspaceId: string;
	userId: string;
	sourceAccountId: string;
	idempotencyKey?: string;
}

export interface TelegramImportProgress {
	runId: string;
	status: TelegramImportRunStatus;
	scope: TelegramImportRun['scope'];
	totalDialogs: number;
	eligibleDialogs: number;
	skippedDialogs: number;
	chatsQueued: number;
	chatsCompleted: number;
	chatsFailed: number;
	messagesSeen: number;
	messagesInserted: number;
	duplicateMessages: number;
	pagesFetched: number;
	requestedAt: Date;
	startedAt: Date | null;
	completedAt: Date | null;
	pausedAt: Date | null;
	cancelledAt: Date | null;
	failedAt: Date | null;
	lastHeartbeatAt: Date | null;
	errorCode: string | null;
	errorMessage: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface TelegramImportProgressWithHistory {
	latest: TelegramImportProgress | null;
	lastDataImport: TelegramImportProgress | null;
}

export async function hasCurrentTelegramConsent(
	userId: string,
	workspaceId: string,
	minConsentVersion: number,
): Promise<boolean> {
	const rows = await db
		.select({
			consentTelegramAccess: userCalibrations.consentTelegramAccess,
			consentVersion: userCalibrations.consentVersion,
		})
		.from(userCalibrations)
		.where(and(eq(userCalibrations.userId, userId), eq(userCalibrations.workspaceId, workspaceId)))
		.limit(1);

	const row = rows[0];
	return row?.consentTelegramAccess === true && row.consentVersion >= minConsentVersion;
}

export async function findActiveTelegramImportRun(
	workspaceId: string,
	userId: string,
	sourceAccountId: string,
): Promise<TelegramImportRun | null> {
	const rows = await db
		.select()
		.from(telegramImportRuns)
		.where(
			and(
				eq(telegramImportRuns.workspaceId, workspaceId),
				eq(telegramImportRuns.userId, userId),
				eq(telegramImportRuns.sourceAccountId, sourceAccountId),
				inArray(telegramImportRuns.status, TELEGRAM_IMPORT_ACTIVE_STATUSES),
			),
		)
		.orderBy(desc(telegramImportRuns.createdAt))
		.limit(1);

	return rows[0] ?? null;
}

export async function createTelegramImportRun(
	input: CreateTelegramImportRunInput,
): Promise<TelegramImportRun> {
	const existing = await findActiveTelegramImportRun(
		input.workspaceId,
		input.userId,
		input.sourceAccountId,
	);
	if (existing) return existing;

	const rows = await db
		.insert(telegramImportRuns)
		.values({
			workspaceId: input.workspaceId,
			userId: input.userId,
			sourceAccountId: input.sourceAccountId,
			idempotencyKey: input.idempotencyKey ?? randomUUID(),
		})
		.returning();

	const row = rows[0];
	if (!row) throw new Error('Failed to create Telegram import run');
	return row;
}

export async function getTelegramImportRun(
	workspaceId: string,
	runId: string,
): Promise<TelegramImportRun | null> {
	const rows = await db
		.select()
		.from(telegramImportRuns)
		.where(and(eq(telegramImportRuns.id, runId), eq(telegramImportRuns.workspaceId, workspaceId)))
		.limit(1);

	return rows[0] ?? null;
}

export async function getLatestTelegramImportRun(
	workspaceId: string,
	userId: string,
): Promise<TelegramImportRun | null> {
	const rows = await db
		.select()
		.from(telegramImportRuns)
		.where(
			and(eq(telegramImportRuns.workspaceId, workspaceId), eq(telegramImportRuns.userId, userId)),
		)
		.orderBy(desc(telegramImportRuns.createdAt))
		.limit(1);

	return rows[0] ?? null;
}

export async function getLatestTelegramImportProgress(
	workspaceId: string,
	userId: string,
): Promise<TelegramImportProgress | null> {
	const run = await getLatestTelegramImportRun(workspaceId, userId);
	if (!run) return null;
	return toProgress(run);
}

export async function getLatestTelegramImportProgressWithHistory(
	workspaceId: string,
	userId: string,
): Promise<TelegramImportProgressWithHistory> {
	const [latest, dataImportRows] = await Promise.all([
		getLatestTelegramImportRun(workspaceId, userId),
		db
			.select()
			.from(telegramImportRuns)
			.where(
				and(
					eq(telegramImportRuns.workspaceId, workspaceId),
					eq(telegramImportRuns.userId, userId),
					sql`(${telegramImportRuns.messagesInserted} > 0 OR ${telegramImportRuns.pagesFetched} > 0 OR ${telegramImportRuns.chatsQueued} > 0)`,
				),
			)
			.orderBy(desc(telegramImportRuns.createdAt))
			.limit(1),
	]);

	return {
		latest: latest ? toProgress(latest) : null,
		lastDataImport: dataImportRows[0] ? toProgress(dataImportRows[0]) : null,
	};
}

export async function updateTelegramImportRunStatus(
	workspaceId: string,
	runId: string,
	status: TelegramImportRunStatus,
	options?: { errorCode?: string; errorMessage?: string },
): Promise<TelegramImportRun | null> {
	const now = new Date();
	const terminalUpdates =
		status === 'completed'
			? { completedAt: now }
			: status === 'cancelled'
				? { cancelledAt: now }
				: status === 'failed'
					? { failedAt: now }
					: status === 'paused'
						? { pausedAt: now }
						: {};

	const rows = await db
		.update(telegramImportRuns)
		.set({
			status,
			...terminalUpdates,
			...(status === 'discovering' || status === 'importing' ? { startedAt: now } : {}),
			...(options?.errorCode ? { errorCode: options.errorCode } : {}),
			...(options?.errorMessage ? { errorMessage: options.errorMessage } : {}),
			lastHeartbeatAt: now,
			updatedAt: now,
		})
		.where(and(eq(telegramImportRuns.id, runId), eq(telegramImportRuns.workspaceId, workspaceId)))
		.returning();

	return rows[0] ?? null;
}

export async function requestTelegramImportPause(
	workspaceId: string,
	userId: string,
	runId: string,
): Promise<TelegramImportRun | null> {
	const rows = await db
		.update(telegramImportRuns)
		.set({ status: 'pausing', updatedAt: sql`now()`, lastHeartbeatAt: sql`now()` })
		.where(
			and(
				eq(telegramImportRuns.id, runId),
				eq(telegramImportRuns.workspaceId, workspaceId),
				eq(telegramImportRuns.userId, userId),
				inArray(telegramImportRuns.status, ['queued', 'discovering', 'importing']),
			),
		)
		.returning();

	return rows[0] ?? null;
}

export async function resumeTelegramImportRun(
	workspaceId: string,
	userId: string,
	runId: string,
): Promise<TelegramImportRun | null> {
	const rows = await db
		.update(telegramImportRuns)
		.set({
			status: 'importing',
			pausedAt: null,
			updatedAt: sql`now()`,
			lastHeartbeatAt: sql`now()`,
		})
		.where(
			and(
				eq(telegramImportRuns.id, runId),
				eq(telegramImportRuns.workspaceId, workspaceId),
				eq(telegramImportRuns.userId, userId),
				eq(telegramImportRuns.status, 'paused'),
			),
		)
		.returning();

	return rows[0] ?? null;
}

export async function requestTelegramImportCancel(
	workspaceId: string,
	userId: string,
	runId: string,
): Promise<TelegramImportRun | null> {
	const rows = await db
		.update(telegramImportRuns)
		.set({ status: 'cancelling', updatedAt: sql`now()`, lastHeartbeatAt: sql`now()` })
		.where(
			and(
				eq(telegramImportRuns.id, runId),
				eq(telegramImportRuns.workspaceId, workspaceId),
				eq(telegramImportRuns.userId, userId),
				inArray(telegramImportRuns.status, [
					'queued',
					'discovering',
					'importing',
					'pausing',
					'paused',
				]),
			),
		)
		.returning();

	return rows[0] ?? null;
}

export async function updateTelegramImportDiscoveryCounts(
	workspaceId: string,
	runId: string,
	counts: {
		totalDialogs: number;
		eligibleDialogs: number;
		skippedDialogs: number;
		chatsQueued: number;
	},
): Promise<void> {
	await db
		.update(telegramImportRuns)
		.set({
			status: counts.chatsQueued > 0 ? 'importing' : 'completed',
			totalDialogs: counts.totalDialogs,
			eligibleDialogs: counts.eligibleDialogs,
			skippedDialogs: counts.skippedDialogs,
			chatsQueued: counts.chatsQueued,
			startedAt: sql`COALESCE(${telegramImportRuns.startedAt}, now())`,
			completedAt: counts.chatsQueued > 0 ? undefined : sql`now()`,
			lastHeartbeatAt: sql`now()`,
			updatedAt: sql`now()`,
		})
		.where(and(eq(telegramImportRuns.id, runId), eq(telegramImportRuns.workspaceId, workspaceId)));
}

export async function upsertTelegramImportRunChat(input: {
	importRunId: string;
	workspaceId: string;
	sourceAccountId: string;
	chatId: string;
	telegramChatId: string;
	chatType: 'private' | 'group' | 'supergroup';
	telegramTopMessageId?: number | null;
	nextOffsetMessageId?: number;
	oldestImportedMessageId?: number | null;
	newestImportedMessageId?: number | null;
}): Promise<TelegramImportRunChat> {
	const rows = await db
		.insert(telegramImportRunChats)
		.values({
			importRunId: input.importRunId,
			workspaceId: input.workspaceId,
			sourceAccountId: input.sourceAccountId,
			chatId: input.chatId,
			telegramChatId: input.telegramChatId,
			chatType: input.chatType,
			telegramTopMessageId: input.telegramTopMessageId ?? null,
			nextOffsetMessageId: input.nextOffsetMessageId ?? 0,
			oldestImportedMessageId: input.oldestImportedMessageId ?? null,
			newestImportedMessageId: input.newestImportedMessageId ?? null,
		})
		.onConflictDoUpdate({
			target: [telegramImportRunChats.importRunId, telegramImportRunChats.telegramChatId],
			set: {
				chatId: input.chatId,
				chatType: input.chatType,
				telegramTopMessageId: input.telegramTopMessageId ?? null,
				nextOffsetMessageId: input.nextOffsetMessageId ?? 0,
				oldestImportedMessageId: input.oldestImportedMessageId ?? null,
				newestImportedMessageId: input.newestImportedMessageId ?? null,
				status: 'queued',
				updatedAt: sql`now()`,
			},
		})
		.returning();

	const row = rows[0];
	if (!row) throw new Error('Failed to create Telegram import chat');
	return row;
}

export async function listQueuedTelegramImportRunChats(
	importRunId: string,
	limit = 50,
): Promise<TelegramImportRunChat[]> {
	return await db
		.select()
		.from(telegramImportRunChats)
		.where(
			and(
				eq(telegramImportRunChats.importRunId, importRunId),
				eq(telegramImportRunChats.status, 'queued'),
			),
		)
		.orderBy(telegramImportRunChats.createdAt)
		.limit(limit);
}

export async function getTelegramImportRunChat(
	workspaceId: string,
	runChatId: string,
): Promise<TelegramImportRunChat | null> {
	const rows = await db
		.select()
		.from(telegramImportRunChats)
		.where(
			and(
				eq(telegramImportRunChats.id, runChatId),
				eq(telegramImportRunChats.workspaceId, workspaceId),
			),
		)
		.limit(1);

	return rows[0] ?? null;
}

export async function updateTelegramImportRunChatStatus(
	workspaceId: string,
	runChatId: string,
	status: TelegramImportChatStatus,
	options?: {
		errorCode?: string;
		errorMessage?: string;
		skipReason?: string;
		rateLimitUntil?: Date;
	},
): Promise<void> {
	const now = new Date();
	await db
		.update(telegramImportRunChats)
		.set({
			status,
			...(status === 'importing' ? { startedAt: now } : {}),
			...(status === 'completed' ? { completedAt: now } : {}),
			...(options?.skipReason ? { skipReason: options.skipReason } : {}),
			...(options?.errorCode ? { errorCode: options.errorCode } : {}),
			...(options?.errorMessage ? { errorMessage: options.errorMessage } : {}),
			...(options?.rateLimitUntil ? { rateLimitUntil: options.rateLimitUntil } : {}),
			updatedAt: now,
		})
		.where(
			and(
				eq(telegramImportRunChats.id, runChatId),
				eq(telegramImportRunChats.workspaceId, workspaceId),
			),
		);
}

export async function failTelegramImportRunChat(
	workspaceId: string,
	runId: string,
	runChatId: string,
	options: {
		errorCode: string;
		errorMessage: string;
	},
): Promise<void> {
	await db.transaction(async (tx) => {
		const rows = await tx
			.update(telegramImportRunChats)
			.set({
				status: 'failed',
				errorCode: options.errorCode,
				errorMessage: options.errorMessage,
				updatedAt: sql`now()`,
			})
			.where(
				and(
					eq(telegramImportRunChats.id, runChatId),
					eq(telegramImportRunChats.workspaceId, workspaceId),
					sql`${telegramImportRunChats.status} <> 'failed'`,
				),
			)
			.returning({ id: telegramImportRunChats.id });

		if (rows[0]) {
			await tx
				.update(telegramImportRuns)
				.set({
					chatsFailed: sql`${telegramImportRuns.chatsFailed} + 1`,
					lastHeartbeatAt: sql`now()`,
					updatedAt: sql`now()`,
				})
				.where(
					and(eq(telegramImportRuns.id, runId), eq(telegramImportRuns.workspaceId, workspaceId)),
				);
		}
	});
}

export async function getTelegramChatImportState(input: {
	workspaceId: string;
	sourceAccountId: string;
	telegramChatId: string;
}): Promise<TelegramChatImportState | null> {
	const rows = await db
		.select()
		.from(telegramChatImportState)
		.where(
			and(
				eq(telegramChatImportState.workspaceId, input.workspaceId),
				eq(telegramChatImportState.sourceAccountId, input.sourceAccountId),
				eq(telegramChatImportState.telegramChatId, input.telegramChatId),
			),
		)
		.limit(1);

	return rows[0] ?? null;
}

export async function getOldestTelegramMessageId(
	workspaceId: string,
	chatId: string,
): Promise<number | null> {
	const rows = await db
		.select({ oldest: sql<number | null>`min((${messages.telegramMessageId})::integer)` })
		.from(messages)
		.where(and(eq(messages.workspaceId, workspaceId), eq(messages.chatId, chatId)))
		.limit(1);

	return rows[0]?.oldest ?? null;
}

export async function listContactIdsForTelegramImportRun(input: {
	workspaceId: string;
	runId: string;
	limit?: number;
}): Promise<string[]> {
	const limit = Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 500);
	const rows = await db
		.select({
			contactId: messages.contactId,
		})
		.from(messages)
		.innerJoin(
			telegramImportRunChats,
			and(
				eq(telegramImportRunChats.workspaceId, messages.workspaceId),
				eq(telegramImportRunChats.chatId, messages.chatId),
			),
		)
		.innerJoin(
			telegramImportRuns,
			and(
				eq(telegramImportRuns.id, telegramImportRunChats.importRunId),
				eq(telegramImportRuns.workspaceId, telegramImportRunChats.workspaceId),
			),
		)
		.where(
			and(
				eq(telegramImportRuns.workspaceId, input.workspaceId),
				eq(telegramImportRuns.id, input.runId),
				sql`${telegramImportRunChats.messagesInserted} > 0`,
				sql`${messages.contactId} IS NOT NULL`,
				sql`${messages.createdAt} >= ${telegramImportRuns.requestedAt}`,
			),
		)
		.groupBy(messages.contactId)
		.limit(limit);

	return rows
		.map((row) => row.contactId)
		.filter((contactId): contactId is string => typeof contactId === 'string');
}

export async function listChatIdsForTelegramImportRun(input: {
	workspaceId: string;
	runId: string;
	limit?: number;
	chatTypes?: Array<'private' | 'group' | 'supergroup'>;
}): Promise<string[]> {
	const limit = Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 500);
	const conditions = [
		eq(telegramImportRunChats.workspaceId, input.workspaceId),
		eq(telegramImportRunChats.importRunId, input.runId),
		sql`${telegramImportRunChats.chatId} IS NOT NULL`,
		sql`${telegramImportRunChats.messagesInserted} > 0`,
	];
	if (input.chatTypes?.length) {
		conditions.push(inArray(telegramImportRunChats.chatType, input.chatTypes));
	}

	const rows = await db
		.select({
			chatId: telegramImportRunChats.chatId,
		})
		.from(telegramImportRunChats)
		.where(and(...conditions))
		.groupBy(telegramImportRunChats.chatId)
		.limit(limit);

	return rows
		.map((row) => row.chatId)
		.filter((chatId): chatId is string => typeof chatId === 'string');
}

export async function recordTelegramImportPage(input: {
	runId: string;
	runChatId: string;
	workspaceId: string;
	sourceAccountId: string;
	chatId: string;
	telegramChatId: string;
	chatType: 'private' | 'group' | 'supergroup';
	nextOffsetMessageId: number;
	oldestImportedMessageId: number | null;
	newestImportedMessageId: number | null;
	messagesSeen: number;
	messagesInserted: number;
	duplicateMessages: number;
	historyComplete: boolean;
	chatComplete?: boolean;
	updateBackfillOffset?: boolean;
}): Promise<void> {
	const chatComplete = input.chatComplete ?? input.historyComplete;
	const updateBackfillOffset = input.updateBackfillOffset ?? true;

	await db
		.update(telegramImportRunChats)
		.set({
			status: chatComplete ? 'completed' : 'queued',
			nextOffsetMessageId: input.nextOffsetMessageId,
			...(input.oldestImportedMessageId !== null && {
				oldestImportedMessageId: sql`LEAST(COALESCE(${telegramImportRunChats.oldestImportedMessageId}, ${input.oldestImportedMessageId}), ${input.oldestImportedMessageId})`,
			}),
			...(input.newestImportedMessageId !== null && {
				newestImportedMessageId: sql`GREATEST(COALESCE(${telegramImportRunChats.newestImportedMessageId}, ${input.newestImportedMessageId}), ${input.newestImportedMessageId})`,
			}),
			pagesFetched: sql`${telegramImportRunChats.pagesFetched} + 1`,
			messagesSeen: sql`${telegramImportRunChats.messagesSeen} + ${input.messagesSeen}`,
			messagesInserted: sql`${telegramImportRunChats.messagesInserted} + ${input.messagesInserted}`,
			duplicateMessages: sql`${telegramImportRunChats.duplicateMessages} + ${input.duplicateMessages}`,
			completedAt: chatComplete ? sql`now()` : null,
			updatedAt: sql`now()`,
		})
		.where(
			and(
				eq(telegramImportRunChats.id, input.runChatId),
				eq(telegramImportRunChats.workspaceId, input.workspaceId),
			),
		);

	await db
		.update(telegramImportRuns)
		.set({
			...(chatComplete && {
				chatsCompleted: sql`${telegramImportRuns.chatsCompleted} + 1`,
			}),
			pagesFetched: sql`${telegramImportRuns.pagesFetched} + 1`,
			messagesSeen: sql`${telegramImportRuns.messagesSeen} + ${input.messagesSeen}`,
			messagesInserted: sql`${telegramImportRuns.messagesInserted} + ${input.messagesInserted}`,
			duplicateMessages: sql`${telegramImportRuns.duplicateMessages} + ${input.duplicateMessages}`,
			lastHeartbeatAt: sql`now()`,
			updatedAt: sql`now()`,
		})
		.where(
			and(
				eq(telegramImportRuns.id, input.runId),
				eq(telegramImportRuns.workspaceId, input.workspaceId),
			),
		);

	await db
		.insert(telegramChatImportState)
		.values({
			workspaceId: input.workspaceId,
			sourceAccountId: input.sourceAccountId,
			chatId: input.chatId,
			telegramChatId: input.telegramChatId,
			chatType: input.chatType,
			historyComplete: input.historyComplete,
			nextOffsetMessageId: input.nextOffsetMessageId,
			oldestImportedMessageId: input.oldestImportedMessageId,
			newestImportedMessageId: input.newestImportedMessageId,
			lastImportRunId: input.runId,
			lastImportedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [
				telegramChatImportState.workspaceId,
				telegramChatImportState.sourceAccountId,
				telegramChatImportState.telegramChatId,
			],
			set: {
				chatId: input.chatId,
				chatType: input.chatType,
				historyComplete: input.historyComplete,
				...(updateBackfillOffset && { nextOffsetMessageId: input.nextOffsetMessageId }),
				...(input.oldestImportedMessageId !== null && {
					oldestImportedMessageId: sql`LEAST(COALESCE(${telegramChatImportState.oldestImportedMessageId}, ${input.oldestImportedMessageId}), ${input.oldestImportedMessageId})`,
				}),
				...(input.newestImportedMessageId !== null && {
					newestImportedMessageId: sql`GREATEST(COALESCE(${telegramChatImportState.newestImportedMessageId}, ${input.newestImportedMessageId}), ${input.newestImportedMessageId})`,
				}),
				lastImportRunId: input.runId,
				lastImportedAt: sql`now()`,
				updatedAt: sql`now()`,
			},
		});
}

export async function hasOpenTelegramImportChats(importRunId: string): Promise<boolean> {
	const rows = await db
		.select({ id: telegramImportRunChats.id })
		.from(telegramImportRunChats)
		.where(
			and(
				eq(telegramImportRunChats.importRunId, importRunId),
				inArray(telegramImportRunChats.status, ['queued', 'importing']),
			),
		)
		.limit(1);

	return rows.length > 0;
}

function toProgress(run: TelegramImportRun): TelegramImportProgress {
	return {
		runId: run.id,
		status: run.status,
		scope: run.scope,
		totalDialogs: run.totalDialogs,
		eligibleDialogs: run.eligibleDialogs,
		skippedDialogs: run.skippedDialogs,
		chatsQueued: run.chatsQueued,
		chatsCompleted: run.chatsCompleted,
		chatsFailed: run.chatsFailed,
		messagesSeen: run.messagesSeen,
		messagesInserted: run.messagesInserted,
		duplicateMessages: run.duplicateMessages,
		pagesFetched: run.pagesFetched,
		requestedAt: run.requestedAt,
		startedAt: run.startedAt,
		completedAt: run.completedAt,
		pausedAt: run.pausedAt,
		cancelledAt: run.cancelledAt,
		failedAt: run.failedAt,
		lastHeartbeatAt: run.lastHeartbeatAt,
		errorCode: run.errorCode,
		errorMessage: run.errorMessage,
		createdAt: run.createdAt,
		updatedAt: run.updatedAt,
	};
}
