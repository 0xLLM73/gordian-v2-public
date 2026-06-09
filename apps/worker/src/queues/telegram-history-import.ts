import type { SealedEnvelope } from '@repo/crypto';
import { decrypt, decryptSessionKek, deriveKeys, encrypt, unwrapWrk } from '@repo/crypto';
import {
	accounts,
	and,
	appendAuditLog,
	contacts,
	createContact,
	db,
	eq,
	failTelegramImportRunChat,
	getCalibration,
	getNullContactSenderMetadataGap,
	getOldestTelegramMessageId,
	getTelegramChatImportState,
	getTelegramImportRun,
	getTelegramImportRunChat,
	hasCurrentTelegramConsent,
	hasOpenTelegramImportChats,
	hasUserAiAnalysisConsent,
	isNull,
	linkMessagesToContact,
	linkMessagesToContactsByTelegramIds,
	listChatIdsForTelegramImportRun,
	listContactIdsForTelegramImportRun,
	listMessageIdsByTelegramIds,
	or,
	recordTelegramImportPage,
	updateMessageSenderMetadataByTelegramIds,
	updateTelegramImportDiscoveryCounts,
	updateTelegramImportRunChatStatus,
	updateTelegramImportRunStatus,
	upsertChat,
	upsertMessages,
	upsertTelegramImportRunChat,
	withWorkspaceRLS,
	workspaces,
} from '@repo/db';
import {
	TELEGRAM_CONSENT_VERSION,
	canRunCommitmentExtraction,
	isAiAnalysisAvailable,
	redactSensitive,
} from '@repo/shared';
import { Queue, Worker } from 'bullmq';
import { canRunConnectionDetection } from '../ai/connection-detection';
import { canRunIntroductionDetection } from '../ai/introduction-detection';
import { disconnectUser, sendToUser } from '../gramjs/thread';
import { withTelegramLock } from '../locks/telegram-session';
import { broadcastUpdate } from '../realtime/broadcast';
import { connection } from '../redis';
import { isTelegramMtProtoPerInteractionUnlockEnabled } from '../telegram-config';
import type { PipelineMessage } from './ai-flow';
import { queueCommitmentReprocess } from './commitment-reprocess';
import { queueConnectionReprocess } from './connection-reprocess';
import { queueIntroductionReprocess } from './introduction-reprocess';
import { scheduleKnowledgeAnalysis } from './knowledge-cron';
import { bufferMessage } from './message-buffer';

interface DiscoverJobData {
	runId: string;
	userId: string;
	workspaceId: string;
	sourceAccountId: string;
	localAnalysisMode?: 'deferred' | 'inline';
	importMode?: 'recent' | 'backfill';
}

interface PageJobData extends DiscoverJobData {
	runChatId: string;
	newerThanMessageId?: number;
	pageNumber?: number;
	preserveBackfillOffset?: boolean;
	existingHistoryComplete?: boolean;
	targetNewestImportedMessageId?: number;
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
	senderPeerId?: string;
	senderPeerType?: 'user' | 'chat' | 'channel';
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

type MessageInsertInput = {
	telegramMessageId: string;
	contactId?: string;
	telegramSenderId?: string;
	telegramSenderType?: 'user' | 'chat' | 'channel';
	text?: string;
	isOutgoing: boolean;
	sentAt: Date;
};

const QUEUE_NAME = 'telegram-history-import';
const PAGE_SIZE = 100;
const DIALOG_LIMIT = 500;
const NEXT_PAGE_DELAY_MS = 1500;
const DEFAULT_FLOOD_WAIT_SECONDS = 60;
const IMPORT_SESSION_CLOSED_MESSAGE =
	'Telegram import session closed before the run finished. Resume the import to unlock Telegram again.';
const DEFAULT_AUTO_COMMITMENT_DISCOVERY_MAX_AGE_DAYS = 7;
const DEFAULT_AUTO_COMMITMENT_DISCOVERY_CONTACT_LIMIT = 100;
const DEFAULT_AUTO_COMMITMENT_DISCOVERY_BATCH_SIZE = 200;
const DEFAULT_AUTO_INTRODUCTION_DISCOVERY_MAX_AGE_DAYS = 30;
const DEFAULT_AUTO_INTRODUCTION_DISCOVERY_CHAT_LIMIT = 100;
const DEFAULT_AUTO_INTRODUCTION_DISCOVERY_BATCH_SIZE = 200;
const DEFAULT_AUTO_CONNECTION_DISCOVERY_MAX_AGE_DAYS = 30;
const DEFAULT_AUTO_CONNECTION_DISCOVERY_CONTACT_LIMIT = 100;
const DEFAULT_AUTO_CONNECTION_DISCOVERY_BATCH_SIZE = 200;
const DEFAULT_RECENT_IMPORT_MAX_PAGES_PER_CHAT = 1;
const DEFAULT_IMPORT_INCREMENTAL_KNOWLEDGE_MESSAGE_THRESHOLD = 100;
const DEFAULT_IMPORT_INCREMENTAL_KNOWLEDGE_CONTACT_LIMIT = 50;
const DEFAULT_IMPORT_WORKER_LOCK_DURATION_MS = 10 * 60 * 1000;
const DEFAULT_IMPORT_WORKER_STALLED_INTERVAL_MS = 60 * 1000;
const DEFAULT_IMPORT_WORKER_MAX_STALLED_COUNT = 2;

function withImportRLS<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
	return withWorkspaceRLS(workspaceId, fn);
}

function short(id: string): string {
	return id.slice(0, 8);
}

function jobIdPart(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

function envFlagEnabled(key: string, fallback: boolean): boolean {
	const value = process.env[key]?.trim().toLowerCase();
	if (!value) return fallback;
	return value !== 'false' && value !== '0' && value !== 'off';
}

function envNumber(key: string, fallback: number, min: number, max: number): number {
	const value = Number(process.env[key]);
	if (!Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.trunc(value), min), max);
}

function shouldRunInlineLocalAnalysis(data: DiscoverJobData): boolean {
	return data.localAnalysisMode === 'inline';
}

function resolveImportMode(data: DiscoverJobData): 'recent' | 'backfill' {
	return data.importMode === 'backfill' ? 'backfill' : 'recent';
}

function recentImportMaxPagesPerChat(): number {
	return envNumber(
		'TELEGRAM_RECENT_IMPORT_MAX_PAGES_PER_CHAT',
		DEFAULT_RECENT_IMPORT_MAX_PAGES_PER_CHAT,
		1,
		50,
	);
}

function completedImportKnowledgeAnalysisOptions(data: DiscoverJobData, messagesInserted: number) {
	const incrementalThreshold = envNumber(
		'KNOWLEDGE_IMPORT_INCREMENTAL_MESSAGE_THRESHOLD',
		DEFAULT_IMPORT_INCREMENTAL_KNOWLEDGE_MESSAGE_THRESHOLD,
		1,
		100_000,
	);
	if (resolveImportMode(data) === 'recent' && messagesInserted <= incrementalThreshold) {
		return {
			mode: 'incremental' as const,
			limit: envNumber(
				'KNOWLEDGE_IMPORT_INCREMENTAL_CONTACT_LIMIT',
				DEFAULT_IMPORT_INCREMENTAL_KNOWLEDGE_CONTACT_LIMIT,
				1,
				500,
			),
		};
	}
	return { mode: 'full' as const };
}

const TELEGRAM_IMPORT_WORKER_OPTS = {
	lockDuration: envNumber(
		'TELEGRAM_IMPORT_WORKER_LOCK_DURATION_MS',
		DEFAULT_IMPORT_WORKER_LOCK_DURATION_MS,
		30_000,
		60 * 60 * 1000,
	),
	stalledInterval: envNumber(
		'TELEGRAM_IMPORT_WORKER_STALLED_INTERVAL_MS',
		DEFAULT_IMPORT_WORKER_STALLED_INTERVAL_MS,
		30_000,
		10 * 60 * 1000,
	),
	maxStalledCount: envNumber(
		'TELEGRAM_IMPORT_WORKER_MAX_STALLED_COUNT',
		DEFAULT_IMPORT_WORKER_MAX_STALLED_COUNT,
		1,
		10,
	),
};

function autoCommitmentDiscoveryConfig() {
	return {
		enabled: envFlagEnabled('COMMITMENT_AUTO_DISCOVERY_AFTER_IMPORT_ENABLED', true),
		maxAgeDays: envNumber(
			'COMMITMENT_AUTO_DISCOVERY_MAX_AGE_DAYS',
			DEFAULT_AUTO_COMMITMENT_DISCOVERY_MAX_AGE_DAYS,
			1,
			3650,
		),
		contactLimit: envNumber(
			'COMMITMENT_AUTO_DISCOVERY_CONTACT_LIMIT',
			DEFAULT_AUTO_COMMITMENT_DISCOVERY_CONTACT_LIMIT,
			1,
			100,
		),
		batchSize: envNumber(
			'COMMITMENT_AUTO_DISCOVERY_BATCH_SIZE',
			DEFAULT_AUTO_COMMITMENT_DISCOVERY_BATCH_SIZE,
			1,
			200,
		),
	};
}

function autoIntroductionDiscoveryConfig() {
	return {
		enabled: envFlagEnabled('INTRODUCTION_AUTO_DISCOVERY_AFTER_IMPORT_ENABLED', true),
		maxAgeDays: envNumber(
			'INTRODUCTION_AUTO_DISCOVERY_MAX_AGE_DAYS',
			DEFAULT_AUTO_INTRODUCTION_DISCOVERY_MAX_AGE_DAYS,
			1,
			3650,
		),
		chatLimit: envNumber(
			'INTRODUCTION_AUTO_DISCOVERY_CHAT_LIMIT',
			DEFAULT_AUTO_INTRODUCTION_DISCOVERY_CHAT_LIMIT,
			1,
			100,
		),
		batchSize: envNumber(
			'INTRODUCTION_AUTO_DISCOVERY_BATCH_SIZE',
			DEFAULT_AUTO_INTRODUCTION_DISCOVERY_BATCH_SIZE,
			1,
			200,
		),
	};
}

function autoConnectionDiscoveryConfig() {
	return {
		enabled: envFlagEnabled('CONNECTION_AUTO_DISCOVERY_AFTER_IMPORT_ENABLED', true),
		maxAgeDays: envNumber(
			'CONNECTION_AUTO_DISCOVERY_MAX_AGE_DAYS',
			DEFAULT_AUTO_CONNECTION_DISCOVERY_MAX_AGE_DAYS,
			1,
			3650,
		),
		contactLimit: envNumber(
			'CONNECTION_AUTO_DISCOVERY_CONTACT_LIMIT',
			DEFAULT_AUTO_CONNECTION_DISCOVERY_CONTACT_LIMIT,
			1,
			100,
		),
		batchSize: envNumber(
			'CONNECTION_AUTO_DISCOVERY_BATCH_SIZE',
			DEFAULT_AUTO_CONNECTION_DISCOVERY_BATCH_SIZE,
			1,
			200,
		),
	};
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
		message.includes('macOS Keychain helper failed') ||
		message.includes('SecItemCopyMatching') ||
		message.includes('Telegram session OS keychain') ||
		message.includes('session KEK')
	) {
		return {
			errorCode: 'TELEGRAM_SESSION_KEY_UNAVAILABLE',
			errorMessage:
				'Could not read the local Telegram session key. Reconnect Telegram from Settings, or approve macOS Keychain access and retry.',
		};
	}
	if (message.includes(IMPORT_SESSION_CLOSED_MESSAGE)) {
		return {
			errorCode: 'TELEGRAM_IMPORT_SESSION_CLOSED',
			errorMessage: IMPORT_SESSION_CLOSED_MESSAGE,
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

function clearLoadedSession(session: { sessionString: string }): void {
	session.sessionString = '';
}

async function runMtProtoInteraction<T>(data: DiscoverJobData, fn: () => Promise<T>): Promise<T> {
	return await withTelegramLock(data.userId, async () => {
		const session = await loadTelegramSession(data);
		try {
			await connectLoadedSession(data.userId, session);
			return await fn();
		} finally {
			clearLoadedSession(session);
			if (isTelegramMtProtoPerInteractionUnlockEnabled()) {
				await disconnectImportSession(data.userId);
			}
		}
	});
}

async function fetchDialogs(data: DiscoverJobData) {
	return await runMtProtoInteraction(data, async () => {
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

async function schedulePostImportLocalAnalysis(input: {
	data: PageJobData;
	envelope: SealedEnvelope;
	chatId: string;
	messages: GramJSMessage[];
	messagesToInsert: MessageInsertInput[];
	newMessageIdByTelegramId: Map<string, string>;
}): Promise<number> {
	const { data, envelope, chatId, messages, messagesToInsert, newMessageIdByTelegramId } = input;

	if (newMessageIdByTelegramId.size === 0) return 0;
	if (!isAiAnalysisAvailable(process.env)) {
		console.log(
			`[telegram-history-import] Local AI analysis unavailable for workspace=${short(data.workspaceId)}, skipping post-import analysis`,
		);
		return 0;
	}
	if (!(await hasUserAiAnalysisConsent(data.userId, data.workspaceId))) {
		console.log(
			`[telegram-history-import] AI consent missing for workspace=${short(data.workspaceId)} user=${short(data.userId)}, skipping post-import analysis`,
		);
		return 0;
	}

	const insertByTelegramId = new Map(
		messagesToInsert.map((message) => [message.telegramMessageId, message]),
	);
	const contactMessages = new Map<string, PipelineMessage[]>();

	for (const message of messages) {
		if (!message.text?.trim()) continue;
		const telegramMessageId = String(message.id);
		const sourceMessageId = newMessageIdByTelegramId.get(telegramMessageId);
		if (!sourceMessageId) continue;

		const inserted = insertByTelegramId.get(telegramMessageId);
		const contactId = inserted?.contactId;
		if (!contactId) continue;

		const existing = contactMessages.get(contactId) ?? [];
		existing.push({
			id: sourceMessageId,
			role: message.isOutgoing ? 'user' : 'assistant',
			content: message.text,
			timestamp: new Date(message.date * 1000).toISOString(),
			sourceMessageId,
			chatId,
			contactId,
		});
		contactMessages.set(contactId, existing);
	}

	if (contactMessages.size === 0) return 0;

	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, data.workspaceId, envelope.wrkVersion);
	const keyEnvelope = {
		encryptedWrk: envelope.encryptedWrk.toString('base64'),
		kmsContext: envelope.kmsContext,
		wrkVersion: envelope.wrkVersion,
	};
	const calibration = await getCalibration(data.userId, data.workspaceId, envelope).catch((err) => {
		console.warn(
			'[telegram-history-import] Failed to load calibration for post-import analysis:',
			redactSensitive(err),
		);
		return null;
	});
	let queuedMessages = 0;

	for (const [contactId, contactBatch] of contactMessages) {
		const encryptedMessages = contactBatch.map((message) => ({
			id: message.id,
			role: message.role,
			content: encrypt(message.content, keys.dek),
			timestamp: message.timestamp,
			sourceMessageId: message.sourceMessageId,
			chatId: message.chatId,
			contactId: message.contactId,
		}));
		bufferMessage(
			data.userId,
			contactId,
			data.workspaceId,
			encryptedMessages,
			keyEnvelope,
			keys.bik.toString('hex'),
			calibration?.commitmentSensitivity ?? undefined,
			data.sourceAccountId,
		);
		queuedMessages += encryptedMessages.length;
	}

	console.log(
		`[telegram-history-import] Buffered ${queuedMessages} newly imported message(s) for local AI analysis in workspace=${short(data.workspaceId)}`,
	);
	await scheduleKnowledgeAnalysis({
		workspaceId: data.workspaceId,
		reason: 'small_sync',
		mode: 'incremental',
	}).catch((err) => {
		console.warn(
			'[telegram-history-import] Failed to schedule incremental knowledge analysis:',
			redactSensitive(err),
		);
	});
	return queuedMessages;
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

async function disconnectImportSession(userId: string): Promise<void> {
	await disconnectUser(userId).catch((err) => {
		console.warn(
			'[telegram-history-import] failed to disconnect import session:',
			redactSensitive(err),
		);
	});
}

async function queueCompletedImportCommitmentDiscovery(data: DiscoverJobData): Promise<void> {
	const config = autoCommitmentDiscoveryConfig();
	if (!config.enabled) return;
	if (!isAiAnalysisAvailable(process.env) || !canRunCommitmentExtraction(process.env)) {
		console.log(
			`[telegram-history-import] Commitment auto-discovery unavailable for workspace=${short(data.workspaceId)}, skipping`,
		);
		return;
	}
	if (!(await hasUserAiAnalysisConsent(data.userId, data.workspaceId))) {
		console.log(
			`[telegram-history-import] AI consent missing for workspace=${short(data.workspaceId)} user=${short(data.userId)}, skipping commitment auto-discovery`,
		);
		return;
	}

	const contactIds = await listContactIdsForTelegramImportRun({
		workspaceId: data.workspaceId,
		runId: data.runId,
		limit: config.contactLimit,
	});
	if (contactIds.length === 0) {
		console.log(
			`[telegram-history-import] No touched contacts for run=${short(data.runId)}, skipping commitment auto-discovery`,
		);
		return;
	}

	const result = await queueCommitmentReprocess({
		workspaceId: data.workspaceId,
		userId: data.userId,
		sourceAccountId: data.sourceAccountId,
		maxAgeDays: config.maxAgeDays,
		contactLimit: contactIds.length,
		contactIds,
		batchSize: config.batchSize,
		skipWorkspaceRelationshipDerivation: true,
	});

	appendAuditLog({
		workspaceId: data.workspaceId,
		actorType: 'system',
		actorId: data.userId,
		action: 'generate',
		resourceType: 'message',
		metadata: {
			operation: 'telegram_import_auto_commitment_reprocess',
			runId: data.runId,
			contactsProcessed: result.contactsProcessed,
			messagesQueued: result.messagesQueued,
			batchSize: result.batchSize,
			contactLimit: result.contactLimit,
			touchedContactCount: contactIds.length,
			maxAgeDays: result.maxAgeDays,
			sourceAccountFiltered: true,
		},
	});

	console.log(
		`[telegram-history-import] Queued auto commitment discovery for ${result.contactsProcessed}/${contactIds.length} touched contact(s), ${result.messagesQueued} message(s), workspace=${short(data.workspaceId)}`,
	);
}

async function queueCompletedImportIntroductionDiscovery(data: DiscoverJobData): Promise<void> {
	const config = autoIntroductionDiscoveryConfig();
	if (!config.enabled) return;
	if (!isAiAnalysisAvailable(process.env) || !canRunIntroductionDetection(process.env)) {
		console.log(
			`[telegram-history-import] Introduction auto-discovery unavailable for workspace=${short(data.workspaceId)}, skipping`,
		);
		return;
	}
	if (!(await hasUserAiAnalysisConsent(data.userId, data.workspaceId))) {
		console.log(
			`[telegram-history-import] AI consent missing for workspace=${short(data.workspaceId)} user=${short(data.userId)}, skipping introduction auto-discovery`,
		);
		return;
	}

	const chatIds = await listChatIdsForTelegramImportRun({
		workspaceId: data.workspaceId,
		runId: data.runId,
		limit: config.chatLimit,
		chatTypes: ['group', 'supergroup'],
	});
	if (chatIds.length === 0) {
		console.log(
			`[telegram-history-import] No touched group chats for run=${short(data.runId)}, skipping introduction auto-discovery`,
		);
		return;
	}

	const result = await queueIntroductionReprocess({
		workspaceId: data.workspaceId,
		userId: data.userId,
		sourceAccountId: data.sourceAccountId,
		maxAgeDays: config.maxAgeDays,
		chatLimit: chatIds.length,
		chatIds,
		batchSize: config.batchSize,
	});

	appendAuditLog({
		workspaceId: data.workspaceId,
		actorType: 'system',
		actorId: data.userId,
		action: 'generate',
		resourceType: 'message',
		metadata: {
			operation: 'telegram_import_auto_introduction_reprocess',
			runId: data.runId,
			chatsProcessed: result.chatsProcessed,
			messagesQueued: result.messagesQueued,
			batchSize: result.batchSize,
			chatLimit: result.chatLimit,
			touchedChatCount: chatIds.length,
			maxAgeDays: result.maxAgeDays,
			sourceAccountFiltered: true,
		},
	});

	console.log(
		`[telegram-history-import] Queued auto introduction discovery for ${result.chatsProcessed}/${chatIds.length} touched group chat(s), ${result.messagesQueued} message(s), workspace=${short(data.workspaceId)}`,
	);
}

async function queueCompletedImportConnectionDiscovery(data: DiscoverJobData): Promise<void> {
	const config = autoConnectionDiscoveryConfig();
	if (!config.enabled) return;
	if (!isAiAnalysisAvailable(process.env) || !canRunConnectionDetection(process.env)) {
		console.log(
			`[telegram-history-import] Connection auto-discovery unavailable for workspace=${short(data.workspaceId)}, skipping`,
		);
		return;
	}
	if (!(await hasUserAiAnalysisConsent(data.userId, data.workspaceId))) {
		console.log(
			`[telegram-history-import] AI consent missing for workspace=${short(data.workspaceId)} user=${short(data.userId)}, skipping connection auto-discovery`,
		);
		return;
	}

	const contactIds = await listContactIdsForTelegramImportRun({
		workspaceId: data.workspaceId,
		runId: data.runId,
		limit: config.contactLimit,
	});
	if (contactIds.length === 0) {
		console.log(
			`[telegram-history-import] No touched contacts for run=${short(data.runId)}, skipping connection auto-discovery`,
		);
		return;
	}

	const result = await queueConnectionReprocess({
		workspaceId: data.workspaceId,
		userId: data.userId,
		sourceAccountId: data.sourceAccountId,
		maxAgeDays: config.maxAgeDays,
		contactLimit: contactIds.length,
		contactIds,
		batchSize: config.batchSize,
	});

	appendAuditLog({
		workspaceId: data.workspaceId,
		actorType: 'system',
		actorId: data.userId,
		action: 'generate',
		resourceType: 'message',
		metadata: {
			operation: 'telegram_import_auto_connection_reprocess',
			runId: data.runId,
			contactsProcessed: result.contactsProcessed,
			messagesQueued: result.messagesQueued,
			batchSize: result.batchSize,
			contactLimit: result.contactLimit,
			touchedContactCount: contactIds.length,
			maxAgeDays: result.maxAgeDays,
			sourceAccountFiltered: true,
		},
	});

	console.log(
		`[telegram-history-import] Queued auto connection discovery for ${result.contactsProcessed}/${contactIds.length} touched contact(s), ${result.messagesQueued} message(s), workspace=${short(data.workspaceId)}`,
	);
}

async function maybeFinalizeRun(data: DiscoverJobData): Promise<void> {
	const result = await withImportRLS(data.workspaceId, async () => {
		const run = await getTelegramImportRun(data.workspaceId, data.runId);
		if (!run) return null;
		const hasOpenChats = await hasOpenTelegramImportChats(data.runId);
		if (hasOpenChats) return null;

		if (run.status === 'cancelling') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'cancelled');
			return { status: 'cancelled' as const, messagesInserted: run.messagesInserted };
		}
		if (run.status === 'pausing') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'paused');
			return { status: 'paused' as const, messagesInserted: run.messagesInserted };
		}
		if (run.status !== 'failed' && run.status !== 'cancelled') {
			await updateTelegramImportRunStatus(data.workspaceId, data.runId, 'completed');
			return { status: 'completed' as const, messagesInserted: run.messagesInserted };
		}
		return null;
	});

	if (result) {
		await broadcastProgress(data.workspaceId, data.runId, result.status);
		await disconnectImportSession(data.userId);
		if (result.status === 'completed' && result.messagesInserted > 0) {
			const knowledgeOptions = completedImportKnowledgeAnalysisOptions(
				data,
				result.messagesInserted,
			);
			await scheduleKnowledgeAnalysis({
				workspaceId: data.workspaceId,
				reason: 'history_import_completed',
				...knowledgeOptions,
				runId: data.runId,
			}).catch((err) => {
				console.warn(
					'[telegram-history-import] Failed to schedule completed-import knowledge analysis:',
					redactSensitive(err),
				);
			});
			await queueCompletedImportCommitmentDiscovery(data).catch((err) => {
				console.warn(
					'[telegram-history-import] Failed to queue completed-import commitment discovery:',
					redactSensitive(err),
				);
			});
			await queueCompletedImportIntroductionDiscovery(data).catch((err) => {
				console.warn(
					'[telegram-history-import] Failed to queue completed-import introduction discovery:',
					redactSensitive(err),
				);
			});
			await queueCompletedImportConnectionDiscovery(data).catch((err) => {
				console.warn(
					'[telegram-history-import] Failed to queue completed-import connection discovery:',
					redactSensitive(err),
				);
			});
		}
	}
}

async function fetchMessagesPage(
	data: PageJobData,
	runChat: { telegramChatId: string; chatType: string; nextOffsetMessageId: number },
) {
	if (isTelegramMtProtoPerInteractionUnlockEnabled()) {
		return await runMtProtoInteraction(data, async () => {
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
	}

	const fetchUnderLock = (session?: { sessionString: string }) =>
		withTelegramLock(data.userId, async () => {
			if (session) {
				try {
					await connectLoadedSession(data.userId, session);
				} finally {
					clearLoadedSession(session);
				}
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
		if (!isTelegramMtProtoPerInteractionUnlockEnabled()) {
			throw new Error(IMPORT_SESSION_CLOSED_MESSAGE);
		}
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
		const mode = resolveImportMode(data);
		let queuedChats = 0;
		let skippedDialogs = dialogs.length - eligibleDialogs.length;
		const queuedRunChats: Array<
			Awaited<ReturnType<typeof upsertTelegramImportRunChat>> & {
				newerThanMessageId?: number;
				preserveBackfillOffset?: boolean;
				existingHistoryComplete?: boolean;
				targetNewestImportedMessageId?: number;
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
			const newestImportedMessageId =
				typeof state?.newestImportedMessageId === 'number' ? state.newestImportedMessageId : null;
			const hasNewerMessages =
				newestImportedMessageId !== null && dialog.topMessage > newestImportedMessageId;

			if (mode === 'recent') {
				if (state && newestImportedMessageId !== null && !hasNewerMessages) {
					skippedDialogs += 1;
					continue;
				}

				const newerThanMessageId = hasNewerMessages ? newestImportedMessageId : undefined;
				const runChat = await upsertTelegramImportRunChat({
					importRunId: data.runId,
					workspaceId: data.workspaceId,
					sourceAccountId: data.sourceAccountId,
					chatId: chat.id,
					telegramChatId: dialog.chatId,
					chatType: dialog.type,
					telegramTopMessageId: dialog.topMessage,
					nextOffsetMessageId: 0,
					oldestImportedMessageId: newerThanMessageId ?? null,
					newestImportedMessageId: dialog.topMessage || null,
				});
				queuedRunChats.push({
					...runChat,
					...(newerThanMessageId ? { newerThanMessageId } : {}),
					...(newerThanMessageId ? { preserveBackfillOffset: true } : {}),
					...(state?.historyComplete ? { existingHistoryComplete: true } : {}),
					...(newerThanMessageId ? { targetNewestImportedMessageId: dialog.topMessage } : {}),
				});
				queuedChats += 1;
				continue;
			}

			const missingSenderMetadata =
				state?.historyComplete && !hasNewerMessages
					? await getNullContactSenderMetadataGap(data.workspaceId, chat.id)
					: 0;
			if (state?.historyComplete && !hasNewerMessages && missingSenderMetadata === 0) {
				skippedDialogs += 1;
				continue;
			}

			const newerThanMessageId = hasNewerMessages ? newestImportedMessageId : undefined;
			const hydrateSenderMetadata = missingSenderMetadata > 0;
			const stateOffset =
				state?.nextOffsetMessageId && state.nextOffsetMessageId > 0
					? state.nextOffsetMessageId
					: null;
			const oldestExisting = newerThanMessageId
				? null
				: hydrateSenderMetadata
					? null
					: (stateOffset ?? (await getOldestTelegramMessageId(data.workspaceId, chat.id)));
			const nextOffsetMessageId =
				newerThanMessageId || hydrateSenderMetadata ? 0 : (oldestExisting ?? 0);
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
			queuedRunChats.push({
				...runChat,
				...(newerThanMessageId ? { newerThanMessageId } : {}),
				...(newerThanMessageId ? { preserveBackfillOffset: true } : {}),
				...(state?.historyComplete ? { existingHistoryComplete: true } : {}),
				...(newerThanMessageId ? { targetNewestImportedMessageId: dialog.topMessage } : {}),
			});
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
					...(data.localAnalysisMode ? { localAnalysisMode: data.localAnalysisMode } : {}),
					importMode: resolveImportMode(data),
					runChatId: chat.id,
					...(chat.newerThanMessageId ? { newerThanMessageId: chat.newerThanMessageId } : {}),
					...(chat.preserveBackfillOffset ? { preserveBackfillOffset: true } : {}),
					...(chat.existingHistoryComplete ? { existingHistoryComplete: true } : {}),
					...(chat.targetNewestImportedMessageId
						? { targetNewestImportedMessageId: chat.targetNewestImportedMessageId }
						: {}),
				},
				chat.nextOffsetMessageId,
				NEXT_PAGE_DELAY_MS,
			),
		),
	);
	await broadcastProgress(data.workspaceId, data.runId, 'importing');
	console.log(
		`[telegram-history-import] queued ${discovery.queuedChats} dialog(s) for run=${short(data.runId)} mode=${resolveImportMode(data)}`,
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
	const mode = resolveImportMode(data);
	const nextPageNumber = (data.pageNumber ?? 0) + 1;
	const pageExhausted = messages.length < PAGE_SIZE;
	const recentPageLimitReached =
		mode === 'recent' &&
		!data.newerThanMessageId &&
		nextPageNumber >= recentImportMaxPagesPerChat();
	const chatComplete = pageExhausted || recentPageLimitReached;
	const historyComplete = data.newerThanMessageId
		? data.existingHistoryComplete === true
		: pageExhausted;
	const recordedNewestImportedMessageId =
		data.newerThanMessageId && !chatComplete
			? null
			: (data.targetNewestImportedMessageId ?? newest);

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
			telegramSenderId: message.senderPeerId ?? message.senderId,
			telegramSenderType:
				message.senderPeerType ?? (message.senderId ? ('user' as const) : undefined),
			text: message.text || undefined,
			isOutgoing: message.isOutgoing,
			sentAt: new Date(message.date * 1000),
		}));
		const messageContactLinks = messagesToInsert.flatMap((message) =>
			message.contactId
				? [{ telegramMessageId: message.telegramMessageId, contactId: message.contactId }]
				: [],
		);
		const messageSenderMetadataLinks = messagesToInsert.flatMap((message) =>
			message.telegramSenderId && message.telegramSenderType
				? [
						{
							telegramMessageId: message.telegramMessageId,
							telegramSenderId: message.telegramSenderId,
							telegramSenderType: message.telegramSenderType,
						},
					]
				: [],
		);
		const existingMessageRows = await listMessageIdsByTelegramIds(
			data.workspaceId,
			runChat.chatId,
			messagesToInsert.map((message) => message.telegramMessageId),
		);
		const existingTelegramMessageIds = new Set(
			existingMessageRows.map((message) => message.telegramMessageId),
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
		if (messageSenderMetadataLinks.length > 0) {
			await updateMessageSenderMetadataByTelegramIds(
				data.workspaceId,
				runChat.chatId,
				messageSenderMetadataLinks,
			);
		}
		if (peerContactId && runChat.chatId) {
			await linkMessagesToContact(data.workspaceId, runChat.chatId, peerContactId);
		}
		if (inserted > 0 && shouldRunInlineLocalAnalysis(data)) {
			const messageIdentityRows = await listMessageIdsByTelegramIds(
				data.workspaceId,
				runChat.chatId,
				messagesToInsert.map((message) => message.telegramMessageId),
			);
			const newMessageIdByTelegramId = new Map(
				messageIdentityRows
					.filter((message) => !existingTelegramMessageIds.has(message.telegramMessageId))
					.map((message) => [message.telegramMessageId, message.id]),
			);
			await schedulePostImportLocalAnalysis({
				data,
				envelope: ready.envelope,
				chatId: runChat.chatId,
				messages,
				messagesToInsert,
				newMessageIdByTelegramId,
			}).catch((err) => {
				console.warn(
					'[telegram-history-import] Failed to schedule post-import local analysis:',
					redactSensitive(err),
				);
			});
		} else if (inserted > 0) {
			console.log(
				`[telegram-history-import] Deferred local AI analysis for ${inserted} newly imported message(s) until import completion workspace=${short(data.workspaceId)}`,
			);
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
			newestImportedMessageId: recordedNewestImportedMessageId,
			messagesSeen: messages.length,
			messagesInserted: inserted,
			duplicateMessages: messages.length - inserted,
			historyComplete,
			chatComplete,
			updateBackfillOffset: !data.preserveBackfillOffset,
		});

		if (recentPageLimitReached && !pageExhausted) {
			console.log(
				`[telegram-history-import] recent import page cap reached run=${short(data.runId)} chat=${short(data.runChatId)} pages=${nextPageNumber}`,
			);
		}

		return {
			action: chatComplete ? ('finalize' as const) : ('enqueue-next' as const),
		};
	});

	if (commit.action === 'finalize') {
		await maybeFinalizeRun(data);
		return;
	}

	if (commit.action === 'enqueue-next') {
		await enqueueRunChatPage({ ...data, pageNumber: nextPageNumber }, nextOffsetMessageId);
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
				await disconnectImportSession(data.userId);
			}
			throw safeErr;
		}
	},
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 1,
		...TELEGRAM_IMPORT_WORKER_OPTS,
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
