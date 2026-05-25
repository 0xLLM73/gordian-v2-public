import type { SealedEnvelope } from '@repo/crypto';
import { decrypt, decryptSessionKek } from '@repo/crypto';
import {
	accounts,
	and,
	contacts,
	createContact,
	db,
	eq,
	failTelegramImportRunChat,
	getOldestTelegramMessageId,
	getTelegramChatImportState,
	getTelegramImportRun,
	getTelegramImportRunChat,
	hasCurrentTelegramConsent,
	hasOpenTelegramImportChats,
	isNull,
	linkMessagesToContact,
	linkMessagesToContactsByTelegramIds,
	or,
	recordTelegramImportPage,
	updateTelegramImportDiscoveryCounts,
	updateTelegramImportRunChatStatus,
	updateTelegramImportRunStatus,
	upsertChat,
	upsertMessages,
	upsertTelegramImportRunChat,
	withWorkspaceRLS,
	workspaces,
} from '@repo/db';
import { TELEGRAM_CONSENT_VERSION, redactSensitive } from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { sendToUser } from '../gramjs/thread';
import { withTelegramLock } from '../locks/telegram-session';
import { broadcastUpdate } from '../realtime/broadcast';
import { connection } from '../redis';

interface DiscoverJobData {
	runId: string;
	userId: string;
	workspaceId: string;
	sourceAccountId: string;
}

interface PageJobData extends DiscoverJobData {
	runChatId: string;
	newerThanMessageId?: number;
}

type TelegramHistoryImportJobData = DiscoverJobData | PageJobData;

interface GramJSDialog {
	chatId: string;
	type: 'private' | 'group' | 'supergroup' | 'channel';
	title?: string;
	username?: string;
	participantCount?: number;
	topMessage: number;
	unreadCount: number;
	isBot: boolean;
}

interface GramJSMessage {
	id: number;
	text: string;
	date: number;
	senderId?: string;
	isOutgoing: boolean;
}

interface GramJSSenderUser {
	telegramId: string;
	firstName: string;
	lastName: string;
	username: string;
	isBot: boolean;
}

type CreateContactWithUsernameInput = Parameters<typeof createContact>[1] & {
	username?: string;
};

const QUEUE_NAME = 'telegram-history-import';
const PAGE_SIZE = 100;
const DIALOG_LIMIT = 500;
const NEXT_PAGE_DELAY_MS = 1500;
const DEFAULT_FLOOD_WAIT_SECONDS = 60;

function withImportRLS<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
	return withWorkspaceRLS(workspaceId, fn);
}

function short(id: string): string {
	return id.slice(0, 8);
}

function jobIdPart(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

function discoverJobId(runId: string): string {
	return `telegram-history-${jobIdPart(runId)}-discover`;
}

function pageJobId(runId: string, runChatId: string, cursor: number, suffix = ''): string {
	return `telegram-history-${jobIdPart(runId)}-${jobIdPart(runChatId)}-${cursor}${suffix}`;
}

function isPageJob(data: TelegramHistoryImportJobData): data is PageJobData {
	return 'runChatId' in data;
}

function isEligibleDialog(dialog: GramJSDialog): dialog is GramJSDialog & {
	type: 'private' | 'group' | 'supergroup';
} {
	return !dialog.isBot && ['private', 'group', 'supergroup'].includes(dialog.type);
}

function normalizeTelegramUsername(username: string | undefined): string | undefined {
	const trimmed = username?.trim();
	return trimmed || undefined;
}

function withTelegramUsername<T extends object>(
	input: T,
	username: string | undefined,
): T & { username?: string } {
	const normalized = normalizeTelegramUsername(username);
	return normalized ? { ...input, username: normalized } : input;
}

function floodWaitSeconds(err: unknown): number | null {
	const message = err instanceof Error ? err.message : String(err);
	const match = message.match(/FLOOD_WAIT_?(\d+)/i) ?? message.match(/wait of (\d+) seconds/i);
	if (!match) return null;
	const seconds = Number(match[1]);
	return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_FLOOD_WAIT_SECONDS;
}

function importFailureDetails(err: unknown): { errorCode: string; errorMessage: string } {
	const message = err instanceof Error ? err.message : String(err);
	if (
		message.includes('find-generic-password') ||
		message.includes('Telegram session OS keychain') ||
		message.includes('session KEK')
	) {
		return {
			errorCode: 'TELEGRAM_SESSION_KEY_UNAVAILABLE',
			errorMessage:
				'Could not read the local Telegram session key. Reconnect Telegram from Settings, or approve macOS Keychain access and retry.',
		};
	}
	return {
		errorCode: 'TELEGRAM_IMPORT_FAILED',
		errorMessage: 'Telegram history import failed. Check worker logs for the redacted error.',
	};
}

async function getWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	const ws = result[0];
	if (!ws) return null;
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};
}

async function getTelegramAccount(
	userId: string,
	sourceAccountId: string,
): Promise<{ rawCiphertext: string; telegramUserId: string; sessionKekEncrypted: Buffer } | null> {
	const rows = await db
		.select({
			accessToken: accounts.accessToken,
			accountId: accounts.accountId,
			sessionKekEncrypted: accounts.sessionKekEncrypted,
		})
		.from(accounts)
		.where(
			and(
				eq(accounts.userId, userId),
				eq(accounts.providerId, 'telegram'),
				eq(accounts.accountId, sourceAccountId),
			),
		)
		.limit(1);

	const account = rows[0];
	if (!account?.accessToken) return null;
	if (!account.sessionKekEncrypted) {
		throw new Error('Legacy Telegram session requires re-authentication');
	}
	return {
		rawCiphertext: account.accessToken,
		telegramUserId: account.accountId,
		sessionKekEncrypted: account.sessionKekEncrypted,
	};
}

async function loadTelegramSession(
	data: DiscoverJobData,
): Promise<{ sessionString: string; telegramUserId: string }> {
	const account = await withImportRLS(data.workspaceId, () =>
		getTelegramAccount(data.userId, data.sourceAccountId),
	);
	if (!account) {
		throw new Error('No Telegram session found for selected account');
	}

	const kek = await decryptSessionKek(account.sessionKekEncrypted, data.userId);
	try {
		return {
			sessionString: decrypt(account.rawCiphertext, kek),
			telegramUserId: account.telegramUserId,
		};
	} finally {
		kek.fill(0);
	}
}

async function connectLoadedSession(
	userId: string,
	session: { sessionString: string },
): Promise<void> {
	await sendToUser(userId, { type: 'connect', sessionString: session.sessionString });
}

async function fetchDialogs(data: DiscoverJobData) {
	const session = await loadTelegramSession(data);
	return await withTelegramLock(data.userId, async () => {
		await connectLoadedSession(data.userId, session);
		return await sendToUser<{ type: string; dialogs: GramJSDialog[] }>(data.userId, {
			type: 'get-dialogs',
			limit: DIALOG_LIMIT,
		});
	});
}

async function buildTelegramContactMap(
	workspaceId: string,
	sourceAccountId: string,
): Promise<Map<string, string>> {
	const rows = await db
		.select({
			id: contacts.id,
			telegramId: contacts.telegramId,
			sourceAccountId: contacts.sourceAccountId,
		})
		.from(contacts)
		.where(
			and(
				eq(contacts.workspaceId, workspaceId),
				or(eq(contacts.sourceAccountId, sourceAccountId), isNull(contacts.sourceAccountId)),
			),
		);

	const map = new Map<string, string>();
	for (const row of rows) {
		if (!row.telegramId) continue;
		if (row.sourceAccountId === sourceAccountId || !map.has(row.telegramId)) {
			map.set(row.telegramId, row.id);
		}
	}
	return map;
}

async function createMissingSenderContacts(
	workspaceId: string,
	sourceAccountId: string,
	senderUsers: GramJSSenderUser[],
	senderIds: Set<string>,
	contactMap: Map<string, string>,
	envelope: SealedEnvelope,
): Promise<number> {
	let createdCount = 0;
	const uniqueUsers = new Map<string, GramJSSenderUser>();
	for (const user of senderUsers) {
		if (!user.telegramId || user.isBot || user.telegramId === sourceAccountId) continue;
		if (!senderIds.has(user.telegramId) || contactMap.has(user.telegramId)) continue;
		uniqueUsers.set(user.telegramId, user);
	}

	for (const user of uniqueUsers.values()) {
		try {
			const input: CreateContactWithUsernameInput = withTelegramUsername(
				{
					firstName: user.firstName || undefined,
					lastName: user.lastName || undefined,
					telegramId: user.telegramId,
					sourceAccountId,
				},
				user.username,
			);
			const created = await createContact(workspaceId, input, envelope);
			if (created) {
				contactMap.set(user.telegramId, created.id);
				createdCount += 1;
			}
		} catch (err) {
			console.warn(
				'[telegram-history-import] failed to create sender contact:',
				redactSensitive(err),
			);
		}
	}

	return createdCount;
}

async function assertImportCanRun(data: DiscoverJobData): Promise<void> {
	const run = await getTelegramImportRun(data.workspaceId, data.runId);
	if (!run) {
		throw new Error('Telegram import run not found');
	}
	if (run.userId !== data.userId || run.sourceAccountId !== data.sourceAccountId) {
		throw new Error('Telegram import job does not match its run');
	}

	const hasConsent = await hasCurrentTelegramConsent(
		data.userId,
		data.workspaceId,
		TELEGRAM_CONSENT_VERSION,
	);
	if (!hasConsent) {
		throw new Error('Telegram import consent is required');
	}
}

async function enqueueRunChatPage(
	data: PageJobData,
	cursor: number,
	delay = NEXT_PAGE_DELAY_MS,
	suffix = '',
): Promise<void> {
	await telegramHistoryImportQueue.add('import-page', data, {
		jobId: pageJobId(data.runId, data.runChatId, cursor, suffix),
		delay,
	});
}

async function broadcastProgress(
	workspaceId: string,
	runId: string,
	status: string,
): Promise<void> {
	await broadcastUpdate(workspaceId, 'telegram-history-import-progress', {
		runId,
		status,
	}).catch(() => {});
}

async function maybeFinalizeRun(data: DiscoverJobData): Promise<void> {
	const status = await withImportRLS(data.workspaceId, async () => {
		const run = await getTelegramImportRun(data.workspaceId, data.runId);
		if (!run) return null;
		const hasOpenChats = await hasOpenTelegramImportChats(data.runId);
		if (hasOpenChats) return null;

		if (run.status === 'cancelling') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'cancelled');
			return 'cancelled';
		}
		if (run.status === 'pausing') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'paused');
			return 'paused';
		}
		if (run.status !== 'failed' && run.status !== 'cancelled') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'completed');
			return 'completed';
		}
		return null;
	});

	if (status) {
		await broadcastProgress(data.workspaceId, data.runId, status);
	}
}

async function fetchMessagesPage(
	data: PageJobData,
	runChat: { telegramChatId: string; chatType: string; nextOffsetMessageId: number },
) {
	const fetchUnderLock = (session?: { sessionString: string }) =>
		withTelegramLock(data.userId, async () => {
			if (session) {
				await connectLoadedSession(data.userId, session);
			}
			return await sendToUser<{
				type: string;
				messages: GramJSMessage[];
				users?: GramJSSenderUser[];
			}>(data.userId, {
				type: 'get-messages',
				peerId: runChat.telegramChatId,
				peerType: runChat.chatType,
				limit: PAGE_SIZE,
				offsetId: runChat.nextOffsetMessageId,
				...(data.newerThanMessageId && data.newerThanMessageId > 0
					? { minId: data.newerThanMessageId }
					: {}),
			});
		});

	try {
		return await fetchUnderLock();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (!message.includes('Client not connected')) throw err;
		const session = await loadTelegramSession(data);
		return await fetchUnderLock(session);
	}
}

async function processDiscover(data: DiscoverJobData): Promise<void> {
	const ready = await withImportRLS(data.workspaceId, async () => {
		await assertImportCanRun(data);

		const run = await getTelegramImportRun(data.workspaceId, data.runId);
		if (!run) return { action: 'stop' as const };
		if (run.status === 'cancelling') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'cancelled');
			return { action: 'broadcast' as const, status: 'cancelled' as const };
		}
		if (run.status === 'pausing' || run.status === 'paused') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'paused');
			return { action: 'broadcast' as const, status: 'paused' as const };
		}
		if (['completed', 'cancelled', 'failed'].includes(run.status)) {
			return { action: 'stop' as const };
		}

		const envelope = await getWorkspaceEnvelope(data.workspaceId);
		if (!envelope) throw new Error('Workspace encryption key not found');

		await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'discovering');
		return { action: 'continue' as const, envelope };
	});

	if (ready.action === 'broadcast') {
		await broadcastProgress(data.workspaceId, data.runId, ready.status);
		return;
	}
	if (ready.action !== 'continue') return;

	const dialogsResult = await fetchDialogs(data);

	const dialogs = dialogsResult.dialogs ?? [];
	const discovery = await withImportRLS(data.workspaceId, async () => {
		const run = await getTelegramImportRun(data.workspaceId, data.runId);
		if (!run) return { action: 'stop' as const };
		if (run.status === 'cancelling') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'cancelled');
			return { action: 'broadcast' as const, status: 'cancelled' as const };
		}
		if (run.status === 'pausing' || run.status === 'paused') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'paused');
			return { action: 'broadcast' as const, status: 'paused' as const };
		}
		if (['completed', 'cancelled', 'failed'].includes(run.status)) {
			return { action: 'stop' as const };
		}

		const eligibleDialogs = dialogs.filter(isEligibleDialog);
		let queuedChats = 0;
		let skippedDialogs = dialogs.length - eligibleDialogs.length;
		const queuedRunChats: Array<
			Awaited<ReturnType<typeof upsertTelegramImportRunChat>> & {
				newerThanMessageId?: number;
			}
		> = [];

		for (const dialog of eligibleDialogs) {
			const chat = await upsertChat(
				data.workspaceId,
				{
					telegramChatId: dialog.chatId,
					sourceAccountId: data.sourceAccountId,
					type: dialog.type,
					title: dialog.title,
					username: dialog.username,
					participantCount: dialog.participantCount,
				},
				ready.envelope,
			);
			if (!chat) {
				skippedDialogs += 1;
				continue;
			}

			const state = await getTelegramChatImportState({
				workspaceId: data.workspaceId,
				sourceAccountId: data.sourceAccountId,
				telegramChatId: dialog.chatId,
			});
			const hasNewerMessages =
				state?.historyComplete &&
				typeof state.newestImportedMessageId === 'number' &&
				dialog.topMessage > state.newestImportedMessageId;
			if (state?.historyComplete && !hasNewerMessages) {
				skippedDialogs += 1;
				continue;
			}

			const newerThanMessageId = hasNewerMessages ? state.newestImportedMessageId : undefined;
			const stateOffset =
				state?.nextOffsetMessageId && state.nextOffsetMessageId > 0
					? state.nextOffsetMessageId
					: null;
			const oldestExisting = newerThanMessageId
				? null
				: (stateOffset ?? (await getOldestTelegramMessageId(data.workspaceId, chat.id)));
			const nextOffsetMessageId = newerThanMessageId ? 0 : (oldestExisting ?? 0);
			const runChat = await upsertTelegramImportRunChat({
				importRunId: data.runId,
				workspaceId: data.workspaceId,
				sourceAccountId: data.sourceAccountId,
				chatId: chat.id,
				telegramChatId: dialog.chatId,
				chatType: dialog.type,
				telegramTopMessageId: dialog.topMessage,
				nextOffsetMessageId,
				oldestImportedMessageId:
					newerThanMessageId ?? (nextOffsetMessageId > 0 ? nextOffsetMessageId : null),
				newestImportedMessageId: dialog.topMessage || null,
			});
			queuedRunChats.push({ ...runChat, ...(newerThanMessageId ? { newerThanMessageId } : {}) });
			queuedChats += 1;
		}

		await updateTelegramImportDiscoveryCounts(data.workspaceId, data.runId, {
			totalDialogs: dialogs.length,
			eligibleDialogs: eligibleDialogs.length,
			skippedDialogs,
			chatsQueued: queuedChats,
		});

		return { action: 'continue' as const, queuedChats, queuedRunChats };
	});

	if (discovery.action === 'broadcast') {
		await broadcastProgress(data.workspaceId, data.runId, discovery.status);
		return;
	}
	if (discovery.action !== 'continue') return;

	if (discovery.queuedChats === 0) {
		await maybeFinalizeRun(data);
		return;
	}

	await Promise.all(
		discovery.queuedRunChats.map((chat) =>
			enqueueRunChatPage(
				{
					runId: data.runId,
					userId: data.userId,
					workspaceId: data.workspaceId,
					sourceAccountId: data.sourceAccountId,
					runChatId: chat.id,
					...(chat.newerThanMessageId ? { newerThanMessageId: chat.newerThanMessageId } : {}),
				},
				chat.nextOffsetMessageId,
				NEXT_PAGE_DELAY_MS,
			),
		),
	);
	await broadcastProgress(data.workspaceId, data.runId, 'importing');
	console.log(
		`[telegram-history-import] queued ${discovery.queuedChats} dialog(s) for run=${short(data.runId)}`,
	);
}

async function processPage(data: PageJobData): Promise<void> {
	const ready = await withImportRLS(data.workspaceId, async () => {
		await assertImportCanRun(data);

		const run = await getTelegramImportRun(data.workspaceId, data.runId);
		if (!run) return { action: 'stop' as const };
		const runChat = await getTelegramImportRunChat(data.workspaceId, data.runChatId);
		if (!runChat) return { action: 'stop' as const };
		if (
			run.userId !== data.userId ||
			run.sourceAccountId !== data.sourceAccountId ||
			runChat.importRunId !== data.runId ||
			runChat.sourceAccountId !== data.sourceAccountId
		) {
			throw new Error('Telegram import page job does not match its run state');
		}
		if (['completed', 'skipped', 'failed', 'cancelled'].includes(runChat.status)) {
			return { action: 'stop' as const };
		}

		if (run.status === 'cancelling') {
			await updateTelegramImportRunChatStatus(data.workspaceId, data.runChatId, 'cancelled');
			return { action: 'finalize' as const };
		}
		if (run.status === 'pausing' || run.status === 'paused') {
			await updateTelegramImportRunChatStatus(data.workspaceId, data.runChatId, 'paused');
			return { action: 'finalize' as const };
		}
		if (['completed', 'cancelled', 'failed'].includes(run.status)) {
			return { action: 'stop' as const };
		}

		const envelope = await getWorkspaceEnvelope(data.workspaceId);
		if (!envelope) throw new Error('Workspace encryption key not found');

		await updateTelegramImportRunChatStatus(data.workspaceId, data.runChatId, 'importing');
		return { action: 'continue' as const, envelope, runChat };
	});

	if (ready.action === 'finalize') {
		await maybeFinalizeRun(data);
		return;
	}
	if (ready.action !== 'continue') return;

	let messagesResult: { type: string; messages: GramJSMessage[]; users?: GramJSSenderUser[] };
	try {
		messagesResult = await fetchMessagesPage(data, ready.runChat);
	} catch (err) {
		const waitSeconds = floodWaitSeconds(err);
		if (waitSeconds) {
			const delayMs = Math.max(waitSeconds, DEFAULT_FLOOD_WAIT_SECONDS) * 1000;
			const rateLimitUntil = new Date(Date.now() + delayMs);
			const retry = await withImportRLS(data.workspaceId, async () => {
				const run = await getTelegramImportRun(data.workspaceId, data.runId);
				const runChat = await getTelegramImportRunChat(data.workspaceId, data.runChatId);
				if (!run || !runChat) return { action: 'stop' as const };
				if (run.status === 'cancelling') {
					await updateTelegramImportRunChatStatus(data.workspaceId, data.runChatId, 'cancelled');
					return { action: 'finalize' as const };
				}
				if (run.status === 'pausing' || run.status === 'paused') {
					await updateTelegramImportRunChatStatus(data.workspaceId, data.runChatId, 'paused');
					return { action: 'finalize' as const };
				}
				if (
					['completed', 'cancelled', 'failed'].includes(run.status) ||
					['completed', 'skipped', 'failed', 'cancelled'].includes(runChat.status) ||
					runChat.nextOffsetMessageId !== ready.runChat.nextOffsetMessageId
				) {
					return { action: 'stop' as const };
				}

				await updateTelegramImportRunChatStatus(data.workspaceId, data.runChatId, 'queued', {
					rateLimitUntil,
				});
				return { action: 'retry' as const };
			});

			if (retry.action === 'finalize') {
				await maybeFinalizeRun(data);
				return;
			}
			if (retry.action === 'retry') {
				await enqueueRunChatPage(
					data,
					ready.runChat.nextOffsetMessageId,
					delayMs,
					`-retry-${Math.floor(rateLimitUntil.getTime() / 1000)}`,
				);
			}
			return;
		}
		throw err;
	}

	const messages = (messagesResult.messages ?? []).filter((message) => message.id > 0);
	const messageIds = messages.map((message) => message.id);
	const oldest = messageIds.length > 0 ? Math.min(...messageIds) : null;
	const newest = messageIds.length > 0 ? Math.max(...messageIds) : null;
	const nextOffsetMessageId = oldest ?? ready.runChat.nextOffsetMessageId;
	const historyComplete = messages.length < PAGE_SIZE;

	const commit = await withImportRLS(data.workspaceId, async () => {
		const run = await getTelegramImportRun(data.workspaceId, data.runId);
		const runChat = await getTelegramImportRunChat(data.workspaceId, data.runChatId);
		if (!run || !runChat) return { action: 'stop' as const };
		if (run.status === 'cancelling') {
			await updateTelegramImportRunChatStatus(data.workspaceId, data.runChatId, 'cancelled');
			return { action: 'finalize' as const };
		}
		if (run.status === 'pausing' || run.status === 'paused') {
			await updateTelegramImportRunChatStatus(data.workspaceId, data.runChatId, 'paused');
			return { action: 'finalize' as const };
		}
		if (
			['completed', 'cancelled', 'failed'].includes(run.status) ||
			['completed', 'skipped', 'failed', 'cancelled'].includes(runChat.status) ||
			runChat.nextOffsetMessageId !== ready.runChat.nextOffsetMessageId
		) {
			return { action: 'stop' as const };
		}

		const contactMap = await buildTelegramContactMap(data.workspaceId, data.sourceAccountId);
		const senderIds = new Set(
			messages.map((message) => message.senderId).filter((id): id is string => Boolean(id)),
		);
		if (senderIds.size > 0) {
			await createMissingSenderContacts(
				data.workspaceId,
				data.sourceAccountId,
				messagesResult.users ?? [],
				senderIds,
				contactMap,
				ready.envelope,
			);
		}
		const peerContactId =
			runChat.chatType === 'private' ? contactMap.get(runChat.telegramChatId) : undefined;
		if (!runChat.chatId) {
			throw new Error('Import chat record is missing chatId');
		}
		const messagesToInsert = messages.map((message) => ({
			telegramMessageId: String(message.id),
			contactId: (message.senderId ? contactMap.get(message.senderId) : undefined) ?? peerContactId,
			text: message.text || undefined,
			isOutgoing: message.isOutgoing,
			sentAt: new Date(message.date * 1000),
		}));
		const messageContactLinks = messagesToInsert.flatMap((message) =>
			message.contactId
				? [{ telegramMessageId: message.telegramMessageId, contactId: message.contactId }]
				: [],
		);

		const inserted = await upsertMessages(
			data.workspaceId,
			runChat.chatId,
			messagesToInsert,
			ready.envelope,
		);
		if (messageContactLinks.length > 0) {
			await linkMessagesToContactsByTelegramIds(
				data.workspaceId,
				runChat.chatId,
				messageContactLinks,
			);
		}
		if (peerContactId && runChat.chatId) {
			await linkMessagesToContact(data.workspaceId, runChat.chatId, peerContactId);
		}

		await recordTelegramImportPage({
			runId: data.runId,
			runChatId: data.runChatId,
			workspaceId: data.workspaceId,
			sourceAccountId: data.sourceAccountId,
			chatId: runChat.chatId,
			telegramChatId: runChat.telegramChatId,
			chatType: runChat.chatType as 'private' | 'group' | 'supergroup',
			nextOffsetMessageId,
			oldestImportedMessageId: oldest,
			newestImportedMessageId: newest,
			messagesSeen: messages.length,
			messagesInserted: inserted,
			duplicateMessages: messages.length - inserted,
			historyComplete,
		});

		return {
			action: historyComplete ? ('finalize' as const) : ('enqueue-next' as const),
		};
	});

	if (commit.action === 'finalize') {
		await maybeFinalizeRun(data);
		return;
	}

	if (commit.action === 'enqueue-next') {
		await enqueueRunChatPage(data, nextOffsetMessageId);
	}
}

export const telegramHistoryImportQueue = new Queue<TelegramHistoryImportJobData>(QUEUE_NAME, {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 10000 },
		removeOnComplete: true,
		removeOnFail: { count: 25, age: 3600 },
	},
});

export const telegramHistoryImportWorker = new Worker<TelegramHistoryImportJobData>(
	QUEUE_NAME,
	async (job) => {
		const data = job.data;
		try {
			if (isPageJob(data)) {
				await processPage(data);
			} else {
				await processDiscover(data);
			}
		} catch (err) {
			const safeErr = new Error(redactSensitive(err));
			console.error('[telegram-history-import] job failed:', safeErr.message);
			const maxAttempts = job.opts.attempts ?? 1;
			const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
			if (isFinalAttempt) {
				const failure = importFailureDetails(err);
				await withImportRLS(data.workspaceId, async () => {
					const run = await getTelegramImportRun(data.workspaceId, data.runId);
					if (
						!run ||
						['pausing', 'paused', 'cancelling', 'cancelled', 'completed', 'failed'].includes(
							run.status,
						)
					) {
						return;
					}
					await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'failed', {
						errorCode: failure.errorCode,
						errorMessage: failure.errorMessage,
					});
					if (isPageJob(data)) {
						await failTelegramImportRunChat(data.workspaceId, data.runId, data.runChatId, {
							errorCode: failure.errorCode,
							errorMessage: failure.errorMessage,
						});
					}
				}).catch((statusErr) => {
					console.error(
						'[telegram-history-import] failed to mark run failed:',
						redactSensitive(statusErr),
					);
				});
			}
			throw safeErr;
		}
	},
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 1,
		limiter: { max: 1, duration: NEXT_PAGE_DELAY_MS },
	},
);

telegramHistoryImportWorker.on('failed', (job, err) => {
	console.error(
		`[telegram-history-import] job ${job?.id ?? 'unknown'} failed:`,
		redactSensitive(err),
	);
});

export function enqueueTelegramHistoryImport(data: DiscoverJobData): Promise<unknown> {
	return telegramHistoryImportQueue.add('discover', data, { jobId: discoverJobId(data.runId) });
}
