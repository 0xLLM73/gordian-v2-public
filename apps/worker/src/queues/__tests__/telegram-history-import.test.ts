import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ACCOUNT_ID = '6790809932';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

const state = vi.hoisted(() => ({
	rlsDepth: 0,
	lockDepth: 0,
	hasConsent: true,
	hasAiConsent: true,
	decryptError: null as Error | null,
	getMessagesError: null as Error | null,
	messagesResult: {
		type: 'messages-result',
		messages: [] as Array<Record<string, unknown>>,
		users: [] as Array<Record<string, unknown>>,
	},
	contactRows: [] as Array<Record<string, unknown>>,
	messageIdentityRows: [] as Array<{ id: string; telegramMessageId: string }>,
	dialogs: [] as Array<Record<string, unknown>>,
	importState: null as null | {
		historyComplete: boolean;
		nextOffsetMessageId: number;
		newestImportedMessageId: number | null;
	},
	runMessagesInserted: 0,
	runChatType: 'private' as 'private' | 'group' | 'supergroup',
	runChatNextOffsetMessageId: 100,
	runStatuses: [] as string[],
	decryptStates: [] as Array<{ lockDepth: number; rlsDepth: number }>,
	sendMessages: [] as Array<Record<string, unknown>>,
	sendStates: [] as Array<{ lockDepth: number; rlsDepth: number; type: string }>,
	workerProcessor: undefined as undefined | ((job: unknown) => Promise<unknown>),
}));

const mockQueueAdd = vi.hoisted(() => vi.fn());
const mockWorkerOn = vi.hoisted(() => vi.fn());
const mockFailTelegramImportRunChat = vi.hoisted(() => vi.fn());
const mockGetTelegramImportRun = vi.hoisted(() => vi.fn());
const mockGetTelegramImportRunChat = vi.hoisted(() => vi.fn());
const mockGetTelegramChatImportState = vi.hoisted(() => vi.fn());
const mockGetNullContactSenderMetadataGap = vi.hoisted(() => vi.fn());
const mockGetOldestTelegramMessageId = vi.hoisted(() => vi.fn());
const mockRecordTelegramImportPage = vi.hoisted(() => vi.fn());
const mockGetCalibration = vi.hoisted(() => vi.fn());
const mockHasCurrentTelegramConsent = vi.hoisted(() => vi.fn());
const mockHasUserAiAnalysisConsent = vi.hoisted(() => vi.fn());
const mockHasOpenTelegramImportChats = vi.hoisted(() => vi.fn());
const mockListChatIdsForTelegramImportRun = vi.hoisted(() => vi.fn());
const mockListContactIdsForTelegramImportRun = vi.hoisted(() => vi.fn());
const mockUpdateTelegramImportDiscoveryCounts = vi.hoisted(() => vi.fn());
const mockUpdateTelegramImportRunChatStatus = vi.hoisted(() => vi.fn());
const mockUpdateTelegramImportRunStatus = vi.hoisted(() => vi.fn());
const mockUpsertChat = vi.hoisted(() => vi.fn());
const mockCreateContact = vi.hoisted(() => vi.fn());
const mockLinkMessagesToContact = vi.hoisted(() => vi.fn());
const mockLinkMessagesToContactsByTelegramIds = vi.hoisted(() => vi.fn());
const mockListMessageIdsByTelegramIds = vi.hoisted(() => vi.fn());
const mockUpsertMessages = vi.hoisted(() => vi.fn());
const mockUpsertTelegramImportRunChat = vi.hoisted(() => vi.fn());
const mockWithWorkspaceRLS = vi.hoisted(() => vi.fn());
const mockTerminateUser = vi.hoisted(() => vi.fn());
const mockDisconnectUser = vi.hoisted(() => vi.fn());
const mockBufferMessage = vi.hoisted(() => vi.fn());
const mockScheduleKnowledgeAnalysis = vi.hoisted(() => vi.fn());
const mockQueueCommitmentReprocess = vi.hoisted(() => vi.fn());
const mockQueueIntroductionReprocess = vi.hoisted(() => vi.fn());
const mockQueueConnectionReprocess = vi.hoisted(() => vi.fn());
const mockAppendAuditLog = vi.hoisted(() => vi.fn());
const mockEnqueueHealthScoringForWorkspace = vi.hoisted(() => vi.fn());

const DATA = {
	runId: RUN_ID,
	userId: USER_ID,
	workspaceId: WORKSPACE_ID,
	sourceAccountId: SOURCE_ACCOUNT_ID,
};

vi.mock('bullmq', () => ({
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Queue: vi.fn(function () {
		return { add: mockQueueAdd };
	}),
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Worker: vi.fn(function (_name: string, processor: (job: unknown) => Promise<unknown>) {
		state.workerProcessor = processor;
		return { on: mockWorkerOn };
	}),
}));

vi.mock('../../redis', () => ({ connection: {} }));

vi.mock('../../locks/telegram-session', () => ({
	withTelegramLock: vi.fn(async (_userId: string, fn: () => Promise<unknown>) => {
		state.lockDepth += 1;
		try {
			return await fn();
		} finally {
			state.lockDepth -= 1;
		}
	}),
}));

vi.mock('../../gramjs/thread', () => ({
	sendToUser: vi.fn(
		async (_userId: string, message: { type: string } & Record<string, unknown>) => {
			state.sendMessages.push(message);
			state.sendStates.push({
				type: message.type,
				rlsDepth: state.rlsDepth,
				lockDepth: state.lockDepth,
			});
			if (message.type === 'get-dialogs') {
				return { type: 'dialogs-result', dialogs: state.dialogs };
			}
			if (message.type === 'get-messages') {
				if (state.getMessagesError) throw state.getMessagesError;
				return state.messagesResult;
			}
			return { type: 'ready' };
		},
	),
	disconnectUser: mockDisconnectUser,
	terminateUser: mockTerminateUser,
}));

vi.mock('../../realtime/broadcast', () => ({
	broadcastUpdate: vi.fn(() => Promise.resolve()),
}));

vi.mock('@repo/crypto', () => ({
	decrypt: vi.fn(() => 'session-string'),
	decryptSessionKek: vi.fn(async () => {
		state.decryptStates.push({ rlsDepth: state.rlsDepth, lockDepth: state.lockDepth });
		if (state.decryptError) throw state.decryptError;
		return Buffer.alloc(32, 1);
	}),
	deriveKeys: vi.fn(async () => ({ dek: Buffer.alloc(32, 2), bik: Buffer.alloc(32, 3) })),
	encrypt: vi.fn((value: string) => `encrypted:${value}`),
	unwrapWrk: vi.fn(async () => Buffer.alloc(32, 4)),
}));

vi.mock('@repo/shared', () => ({
	TELEGRAM_CONSENT_VERSION: 1,
	canRunCommitmentExtraction: vi.fn(() => true),
	isAiAnalysisAvailable: vi.fn(() => true),
	redactSensitive: (value: unknown) =>
		String(value).replace(/\btelegram-session:[0-9a-f-]{36}(?::[0-9a-f-]{36})?\b/gi, '[redacted]'),
}));

vi.mock('../message-buffer', () => ({
	bufferMessage: mockBufferMessage,
}));

vi.mock('../knowledge-cron', () => ({
	scheduleKnowledgeAnalysis: mockScheduleKnowledgeAnalysis,
}));

vi.mock('../../ai/connection-detection', () => ({
	canRunConnectionDetection: vi.fn(() => true),
}));

vi.mock('../../ai/introduction-detection', () => ({
	canRunIntroductionDetection: vi.fn(() => true),
}));

vi.mock('../connection-reprocess', () => ({
	queueConnectionReprocess: mockQueueConnectionReprocess,
}));

vi.mock('../commitment-reprocess', () => ({
	queueCommitmentReprocess: mockQueueCommitmentReprocess,
}));

vi.mock('../introduction-reprocess', () => ({
	queueIntroductionReprocess: mockQueueIntroductionReprocess,
}));

vi.mock('../health-scoring-queue', () => ({
	enqueueHealthScoringForWorkspace: mockEnqueueHealthScoringForWorkspace,
}));

vi.mock('@repo/db', () => {
	const selectMock = vi.fn();
	const db = {
		select: selectMock,
	};
	selectMock.mockImplementation((selection: Record<string, unknown>) => ({
		from: vi.fn(() => ({
			where: vi.fn(() => {
				if ('telegramId' in selection && 'sourceAccountId' in selection) {
					return state.contactRows;
				}
				return {
					limit: vi.fn(() => {
						if ('accessToken' in selection) {
							return [
								{
									accessToken: 'encrypted-session',
									accountId: SOURCE_ACCOUNT_ID,
									sessionKekEncrypted: Buffer.from('kek-blob'),
								},
							];
						}
						if ('encryptedWrk' in selection) {
							return [
								{
									encryptedWrk: Buffer.from('wrk').toString('base64'),
									kmsContext: { WorkspaceID: WORKSPACE_ID },
									wrkVersion: 1,
								},
							];
						}
						return [];
					}),
				};
			}),
		})),
	}));

	mockWithWorkspaceRLS.mockImplementation(
		async (_workspaceId: string, fn: () => Promise<unknown>) => {
			state.rlsDepth += 1;
			try {
				return await fn();
			} finally {
				state.rlsDepth -= 1;
			}
		},
	);

	mockGetTelegramImportRun.mockImplementation(async () => ({
		id: RUN_ID,
		status: state.runStatuses.shift() ?? 'queued',
		userId: USER_ID,
		workspaceId: WORKSPACE_ID,
		sourceAccountId: SOURCE_ACCOUNT_ID,
		messagesInserted: state.runMessagesInserted,
	}));
	mockGetTelegramImportRunChat.mockImplementation(async () => ({
		id: '33333333-3333-4333-8333-333333333333',
		importRunId: RUN_ID,
		workspaceId: WORKSPACE_ID,
		sourceAccountId: SOURCE_ACCOUNT_ID,
		chatId: '44444444-4444-4444-8444-444444444444',
		telegramChatId: '123456',
		chatType: state.runChatType,
		status: 'queued',
		nextOffsetMessageId: state.runChatNextOffsetMessageId,
	}));
	mockGetTelegramChatImportState.mockImplementation(async () => state.importState);
	mockGetCalibration.mockResolvedValue({ commitmentSensitivity: 'specific' });
	mockHasCurrentTelegramConsent.mockImplementation(async () => state.hasConsent);
	mockHasUserAiAnalysisConsent.mockImplementation(async () => state.hasAiConsent);
	mockHasOpenTelegramImportChats.mockResolvedValue(false);
	mockUpdateTelegramImportDiscoveryCounts.mockResolvedValue(undefined);
	mockUpdateTelegramImportRunChatStatus.mockResolvedValue(undefined);
	mockUpdateTelegramImportRunStatus.mockResolvedValue(null);
	mockFailTelegramImportRunChat.mockResolvedValue(undefined);
	mockGetOldestTelegramMessageId.mockResolvedValue(null);
	mockUpsertChat.mockResolvedValue({ id: '44444444-4444-4444-8444-444444444444' });
	mockUpsertTelegramImportRunChat.mockImplementation(async (input: Record<string, unknown>) => ({
		id: '33333333-3333-4333-8333-333333333333',
		importRunId: RUN_ID,
		workspaceId: WORKSPACE_ID,
		sourceAccountId: SOURCE_ACCOUNT_ID,
		chatId: '44444444-4444-4444-8444-444444444444',
		telegramChatId: input.telegramChatId,
		chatType: input.chatType,
		status: 'queued',
		nextOffsetMessageId: input.nextOffsetMessageId,
		oldestImportedMessageId: input.oldestImportedMessageId,
		newestImportedMessageId: input.newestImportedMessageId,
	}));

	return {
		accounts: {},
		and: vi.fn(),
		appendAuditLog: mockAppendAuditLog,
		contacts: {},
		createContact: mockCreateContact,
		db,
		eq: vi.fn(),
		failTelegramImportRunChat: mockFailTelegramImportRunChat,
		getCalibration: mockGetCalibration,
		getNullContactSenderMetadataGap: mockGetNullContactSenderMetadataGap,
		getOldestTelegramMessageId: mockGetOldestTelegramMessageId,
		getTelegramChatImportState: mockGetTelegramChatImportState,
		getTelegramImportRun: mockGetTelegramImportRun,
		getTelegramImportRunChat: mockGetTelegramImportRunChat,
		hasCurrentTelegramConsent: mockHasCurrentTelegramConsent,
		hasUserAiAnalysisConsent: mockHasUserAiAnalysisConsent,
		hasOpenTelegramImportChats: mockHasOpenTelegramImportChats,
		isNull: vi.fn(),
		linkMessagesToContact: mockLinkMessagesToContact,
		linkMessagesToContactsByTelegramIds: mockLinkMessagesToContactsByTelegramIds,
		listChatIdsForTelegramImportRun: mockListChatIdsForTelegramImportRun,
		listContactIdsForTelegramImportRun: mockListContactIdsForTelegramImportRun,
		listMessageIdsByTelegramIds: mockListMessageIdsByTelegramIds,
		or: vi.fn(),
		recordTelegramImportPage: mockRecordTelegramImportPage,
		updateMessageSenderMetadataByTelegramIds: vi.fn(() => Promise.resolve(0)),
		updateTelegramImportDiscoveryCounts: mockUpdateTelegramImportDiscoveryCounts,
		updateTelegramImportRunChatStatus: mockUpdateTelegramImportRunChatStatus,
		updateTelegramImportRunStatus: mockUpdateTelegramImportRunStatus,
		upsertChat: mockUpsertChat,
		upsertMessages: mockUpsertMessages,
		upsertTelegramImportRunChat: mockUpsertTelegramImportRunChat,
		withWorkspaceRLS: mockWithWorkspaceRLS,
		workspaces: {},
	};
});

async function loadModule() {
	vi.resetModules();
	return await import('../telegram-history-import');
}

function job(
	attemptsMade = 0,
	overrides: Partial<
		typeof DATA & { historyWindowDays: number; importMode: 'recent' | 'backfill' }
	> = {},
) {
	return {
		attemptsMade,
		data: { ...DATA, ...overrides },
		opts: { attempts: 3 },
	};
}

function pageJob(
	attemptsMade = 0,
	overrides: Partial<
		typeof DATA & {
			runChatId: string;
			localAnalysisMode: 'deferred' | 'inline';
			importMode: 'recent' | 'backfill';
			historyWindowDays: number;
			newerThanMessageId: number;
			pageNumber: number;
			preserveBackfillOffset: boolean;
			existingHistoryComplete: boolean;
			targetNewestImportedMessageId: number;
		}
	> = {},
) {
	return {
		attemptsMade,
		data: {
			...DATA,
			runChatId: '33333333-3333-4333-8333-333333333333',
			...overrides,
		},
		opts: { attempts: 3 },
	};
}

function fullMessagePage(startId = 200) {
	return Array.from({ length: 100 }, (_, index) => ({
		id: startId - index,
		text: `message ${startId - index}`,
		date: 1771111111 - index,
		isOutgoing: false,
	}));
}

beforeEach(() => {
	vi.clearAllMocks();
	state.rlsDepth = 0;
	state.lockDepth = 0;
	state.hasConsent = true;
	state.hasAiConsent = true;
	state.decryptError = null;
	state.getMessagesError = null;
	state.messagesResult = { type: 'messages-result', messages: [], users: [] };
	state.contactRows = [];
	state.messageIdentityRows = [];
	state.dialogs = [];
	state.importState = null;
	state.runMessagesInserted = 0;
	state.runChatType = 'private';
	state.runChatNextOffsetMessageId = 100;
	state.runStatuses = [];
	state.decryptStates = [];
	state.sendMessages = [];
	state.sendStates = [];
	state.workerProcessor = undefined;
	Reflect.deleteProperty(process.env, 'TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK');
	mockCreateContact.mockResolvedValue({ id: 'created-contact-id' });
	mockGetCalibration.mockResolvedValue({ commitmentSensitivity: 'specific' });
	mockGetNullContactSenderMetadataGap.mockResolvedValue(0);
	mockRecordTelegramImportPage.mockResolvedValue(undefined);
	mockLinkMessagesToContact.mockResolvedValue(0);
	mockLinkMessagesToContactsByTelegramIds.mockResolvedValue(0);
	mockListChatIdsForTelegramImportRun.mockResolvedValue([]);
	mockListContactIdsForTelegramImportRun.mockResolvedValue([]);
	mockListMessageIdsByTelegramIds.mockImplementation(async () => state.messageIdentityRows);
	mockUpsertMessages.mockResolvedValue(0);
	mockBufferMessage.mockClear();
	mockScheduleKnowledgeAnalysis.mockResolvedValue({ jobId: 'knowledge-analysis-job' });
	mockQueueCommitmentReprocess.mockResolvedValue({
		contactsProcessed: 4,
		messagesQueued: 120,
		batchSize: 200,
		contactLimit: 100,
		maxAgeDays: 7,
	});
	mockQueueIntroductionReprocess.mockResolvedValue({
		chatsProcessed: 3,
		messagesQueued: 90,
		batchSize: 200,
		chatLimit: 100,
		maxAgeDays: 30,
	});
	mockQueueConnectionReprocess.mockResolvedValue({
		contactsProcessed: 5,
		messagesQueued: 140,
		batchSize: 200,
		contactLimit: 100,
		maxAgeDays: 30,
	});
	mockAppendAuditLog.mockClear();
	mockEnqueueHealthScoringForWorkspace.mockResolvedValue({
		queued: true,
		reason: 'telegram_history_import_completed',
	});
	mockTerminateUser.mockResolvedValue(undefined);
	mockDisconnectUser.mockResolvedValue(undefined);
});

describe('telegram history import queue', () => {
	it('uses BullMQ-safe job ids without colon separators', async () => {
		const { enqueueTelegramHistoryImport } = await loadModule();

		await enqueueTelegramHistoryImport(DATA);

		expect(mockQueueAdd).toHaveBeenCalledWith(
			'discover',
			DATA,
			expect.objectContaining({
				jobId: 'telegram-history-22222222-2222-4222-8222-222222222222-discover',
			}),
		);
		expect(mockQueueAdd.mock.calls[0]?.[2]?.jobId).not.toContain(':');
	});

	it('keeps keychain decrypt outside RLS and disconnects after Telegram discovery', async () => {
		await loadModule();

		await state.workerProcessor?.(job());

		expect(state.decryptStates).toEqual([{ rlsDepth: 0, lockDepth: 1 }]);
		expect(state.sendStates).toEqual([
			{ type: 'connect', rlsDepth: 0, lockDepth: 1 },
			{ type: 'get-dialogs', rlsDepth: 0, lockDepth: 1 },
		]);
		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'discovering',
		);
		expect(mockUpdateTelegramImportDiscoveryCounts).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			expect.objectContaining({ chatsQueued: 0, totalDialogs: 0 }),
		);
		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'completed',
		);
		expect(mockDisconnectUser).toHaveBeenCalledWith(USER_ID);
		expect(mockTerminateUser).not.toHaveBeenCalled();
	});

	it('reuses the import session for Telegram message page fetches by default', async () => {
		await loadModule();

		await state.workerProcessor?.(pageJob());

		expect(state.decryptStates).toEqual([]);
		expect(state.sendStates).toEqual([{ type: 'get-messages', rlsDepth: 0, lockDepth: 1 }]);
		expect(mockDisconnectUser).toHaveBeenCalledWith(USER_ID);
		expect(mockTerminateUser).not.toHaveBeenCalled();
	});

	it('does not re-prompt for the session key when a default import session is closed', async () => {
		state.getMessagesError = new Error('Client not connected');
		await loadModule();

		await expect(state.workerProcessor?.(pageJob(2))).rejects.toThrow(
			'Telegram import session closed before the run finished',
		);

		expect(state.decryptStates).toEqual([]);
		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'failed',
			expect.objectContaining({
				errorCode: 'TELEGRAM_IMPORT_SESSION_CLOSED',
				errorMessage: expect.stringContaining('Resume the import to unlock Telegram again'),
			}),
		);
	});

	it('unlocks and disconnects around each Telegram message page fetch in per-read mode', async () => {
		process.env.TELEGRAM_MTPROTO_PER_INTERACTION_UNLOCK = 'true';
		await loadModule();

		await state.workerProcessor?.(pageJob());

		expect(state.decryptStates).toEqual([{ rlsDepth: 0, lockDepth: 1 }]);
		expect(state.sendStates).toEqual([
			{ type: 'connect', rlsDepth: 0, lockDepth: 1 },
			{ type: 'get-messages', rlsDepth: 0, lockDepth: 1 },
		]);
		expect(mockDisconnectUser).toHaveBeenCalledWith(USER_ID);
		expect(mockTerminateUser).not.toHaveBeenCalled();
	});

	it('queues completed chats again when Telegram reports newer top messages', async () => {
		state.dialogs = [
			{
				chatId: '123456',
				type: 'private',
				title: 'Existing chat',
				topMessage: 125,
				unreadCount: 0,
				isBot: false,
			},
		];
		state.importState = {
			historyComplete: true,
			nextOffsetMessageId: 1,
			newestImportedMessageId: 100,
		};
		await loadModule();

		await state.workerProcessor?.(job());

		expect(mockUpdateTelegramImportDiscoveryCounts).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			expect.objectContaining({ chatsQueued: 1, skippedDialogs: 0 }),
		);
		expect(mockUpsertTelegramImportRunChat).toHaveBeenCalledWith(
			expect.objectContaining({
				nextOffsetMessageId: 0,
				oldestImportedMessageId: 100,
				newestImportedMessageId: 125,
			}),
		);
		expect(mockQueueAdd).toHaveBeenCalledWith(
			'import-page',
			expect.objectContaining({
				runChatId: '33333333-3333-4333-8333-333333333333',
				importMode: 'recent',
				newerThanMessageId: 100,
				preserveBackfillOffset: true,
				existingHistoryComplete: true,
				targetNewestImportedMessageId: 125,
			}),
			expect.objectContaining({ delay: expect.any(Number) }),
		);
	});

	it('skips completed chats without newer messages during recent imports', async () => {
		state.dialogs = [
			{
				chatId: '123456',
				type: 'supergroup',
				title: 'Existing group',
				topMessage: 100,
				unreadCount: 0,
				isBot: false,
			},
		];
		state.importState = {
			historyComplete: true,
			nextOffsetMessageId: 1,
			newestImportedMessageId: 100,
		};
		mockGetNullContactSenderMetadataGap.mockResolvedValueOnce(42);
		await loadModule();

		await state.workerProcessor?.(job());

		expect(mockGetNullContactSenderMetadataGap).not.toHaveBeenCalled();
		expect(mockUpdateTelegramImportDiscoveryCounts).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			expect.objectContaining({ chatsQueued: 0, skippedDialogs: 1 }),
		);
		expect(mockQueueAdd).not.toHaveBeenCalledWith(
			'import-page',
			expect.anything(),
			expect.anything(),
		);
	});

	it('queues completed chats again when sender metadata is missing during backfill', async () => {
		state.dialogs = [
			{
				chatId: '123456',
				type: 'supergroup',
				title: 'Existing group',
				topMessage: 100,
				unreadCount: 0,
				isBot: false,
			},
		];
		state.importState = {
			historyComplete: true,
			nextOffsetMessageId: 1,
			newestImportedMessageId: 100,
		};
		mockGetNullContactSenderMetadataGap.mockResolvedValueOnce(42);
		await loadModule();

		await state.workerProcessor?.(job(0, { importMode: 'backfill' }));

		expect(mockUpdateTelegramImportDiscoveryCounts).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			expect.objectContaining({ chatsQueued: 1, skippedDialogs: 0 }),
		);
		expect(mockUpsertTelegramImportRunChat).toHaveBeenCalledWith(
			expect.objectContaining({
				nextOffsetMessageId: 0,
				oldestImportedMessageId: null,
				newestImportedMessageId: 100,
			}),
		);
		expect(mockQueueAdd).toHaveBeenCalledWith(
			'import-page',
			expect.objectContaining({
				runChatId: '33333333-3333-4333-8333-333333333333',
				importMode: 'backfill',
			}),
			expect.objectContaining({ delay: expect.any(Number) }),
		);
		expect(mockQueueAdd.mock.calls[0]?.[1]).not.toHaveProperty('newerThanMessageId');
	});

	it('fetches incremental pages with a minId lower bound', async () => {
		state.runChatNextOffsetMessageId = 0;
		state.getMessagesError = new Error('FLOOD_WAIT_10');
		await loadModule();

		await state.workerProcessor?.({
			attemptsMade: 0,
			data: {
				...DATA,
				runChatId: '33333333-3333-4333-8333-333333333333',
				newerThanMessageId: 100,
			},
			opts: { attempts: 3 },
		});

		expect(state.sendMessages).toContainEqual(
			expect.objectContaining({
				type: 'get-messages',
				peerId: '123456',
				offsetId: 0,
				minId: 100,
			}),
		);
	});

	it('finishes a recent import page at the configured page cap without marking history complete', async () => {
		state.runChatNextOffsetMessageId = 0;
		state.messagesResult = {
			type: 'messages-result',
			messages: fullMessagePage(200),
			users: [],
		};
		await loadModule();

		await state.workerProcessor?.(pageJob(0, { importMode: 'recent' }));

		expect(mockRecordTelegramImportPage).toHaveBeenCalledWith(
			expect.objectContaining({
				nextOffsetMessageId: 101,
				messagesSeen: 100,
				historyComplete: false,
				chatComplete: true,
				updateBackfillOffset: true,
			}),
		);
		expect(mockQueueAdd).not.toHaveBeenCalledWith(
			'import-page',
			expect.anything(),
			expect.anything(),
		);
		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'completed',
		);
	});

	it('continues full pages during explicit backfill imports', async () => {
		state.runChatNextOffsetMessageId = 0;
		state.messagesResult = {
			type: 'messages-result',
			messages: fullMessagePage(200),
			users: [],
		};
		await loadModule();

		await state.workerProcessor?.(pageJob(0, { importMode: 'backfill' }));

		expect(mockRecordTelegramImportPage).toHaveBeenCalledWith(
			expect.objectContaining({
				nextOffsetMessageId: 101,
				messagesSeen: 100,
				historyComplete: false,
				chatComplete: false,
				updateBackfillOffset: true,
			}),
		);
		expect(mockQueueAdd).toHaveBeenCalledWith(
			'import-page',
			expect.objectContaining({
				importMode: 'backfill',
				pageNumber: 1,
			}),
			expect.objectContaining({ delay: expect.any(Number) }),
		);
	});

	it('stops bounded history windows at the selected cutoff without importing older messages', async () => {
		state.runChatNextOffsetMessageId = 0;
		const nowSeconds = Math.floor(Date.now() / 1000);
		state.messagesResult = {
			type: 'messages-result',
			messages: [
				{
					id: 201,
					text: 'inside the selected history window',
					date: nowSeconds - 10 * 24 * 60 * 60,
					isOutgoing: false,
				},
				...Array.from({ length: 99 }, (_, index) => ({
					id: 200 - index,
					text: `older message ${index}`,
					date: nowSeconds - 100 * 24 * 60 * 60 - index,
					isOutgoing: false,
				})),
			],
			users: [],
		};
		mockUpsertMessages.mockResolvedValueOnce(1);
		await loadModule();

		await state.workerProcessor?.(
			pageJob(0, {
				importMode: 'backfill',
				historyWindowDays: 90,
			}),
		);

		expect(mockUpsertMessages).toHaveBeenCalledWith(
			WORKSPACE_ID,
			'44444444-4444-4444-8444-444444444444',
			[
				expect.objectContaining({
					telegramMessageId: '201',
					text: 'inside the selected history window',
				}),
			],
			expect.any(Object),
		);
		expect(
			mockUpsertMessages.mock.calls[0]?.[2]?.some(
				(message: { telegramMessageId: string }) => message.telegramMessageId === '200',
			),
		).toBe(false);
		expect(mockRecordTelegramImportPage).toHaveBeenCalledWith(
			expect.objectContaining({
				nextOffsetMessageId: 201,
				messagesSeen: 1,
				messagesInserted: 1,
				duplicateMessages: 0,
				historyComplete: false,
				chatComplete: true,
				updateBackfillOffset: true,
			}),
		);
		expect(mockQueueAdd).not.toHaveBeenCalledWith(
			'import-page',
			expect.anything(),
			expect.anything(),
		);
	});

	it('preserves the historical backfill offset while catching up newer messages', async () => {
		state.runChatNextOffsetMessageId = 0;
		state.messagesResult = {
			type: 'messages-result',
			messages: fullMessagePage(250),
			users: [],
		};
		await loadModule();

		await state.workerProcessor?.(
			pageJob(0, {
				importMode: 'recent',
				newerThanMessageId: 100,
				preserveBackfillOffset: true,
				existingHistoryComplete: true,
				targetNewestImportedMessageId: 250,
			}),
		);

		expect(mockRecordTelegramImportPage).toHaveBeenCalledWith(
			expect.objectContaining({
				nextOffsetMessageId: 151,
				newestImportedMessageId: null,
				historyComplete: true,
				chatComplete: false,
				updateBackfillOffset: false,
			}),
		);
		expect(mockQueueAdd).toHaveBeenCalledWith(
			'import-page',
			expect.objectContaining({
				importMode: 'recent',
				newerThanMessageId: 100,
				preserveBackfillOffset: true,
				existingHistoryComplete: true,
				targetNewestImportedMessageId: 250,
				pageNumber: 1,
			}),
			expect.objectContaining({ delay: expect.any(Number) }),
		);
	});

	it('does not commit discovery results after a mid-flight cancel', async () => {
		state.runStatuses = ['queued', 'queued', 'cancelling'];
		await loadModule();

		await state.workerProcessor?.(job());

		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'discovering',
		);
		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'cancelled',
		);
		expect(mockUpdateTelegramImportDiscoveryCounts).not.toHaveBeenCalled();
		expect(mockQueueAdd).not.toHaveBeenCalledWith(
			'import-page',
			expect.anything(),
			expect.anything(),
		);
	});

	it('does not enqueue a flood-wait retry after a mid-flight cancel', async () => {
		state.runStatuses = ['queued', 'queued', 'cancelling', 'cancelling'];
		state.getMessagesError = new Error('FLOOD_WAIT_10');
		await loadModule();

		await state.workerProcessor?.(pageJob());

		expect(mockUpdateTelegramImportRunChatStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			'33333333-3333-4333-8333-333333333333',
			'importing',
		);
		expect(mockUpdateTelegramImportRunChatStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			'33333333-3333-4333-8333-333333333333',
			'cancelled',
		);
		expect(mockQueueAdd).not.toHaveBeenCalledWith(
			'import-page',
			expect.anything(),
			expect.objectContaining({ delay: expect.any(Number) }),
		);
	});

	it('passes chat type to GramJS history fetches so regular groups are not resolved as users', async () => {
		state.runChatType = 'group';
		state.getMessagesError = new Error('FLOOD_WAIT_10');
		await loadModule();

		await state.workerProcessor?.(pageJob());

		expect(state.sendMessages).toContainEqual(
			expect.objectContaining({
				type: 'get-messages',
				peerId: '123456',
				peerType: 'group',
			}),
		);
	});

	it('creates contacts from Telegram history sender users and links group messages', async () => {
		state.runChatType = 'supergroup';
		state.messagesResult = {
			type: 'messages-result',
			messages: [
				{
					id: 101,
					text: 'group update',
					date: 1771111111,
					senderId: '12345',
					isOutgoing: false,
				},
			],
			users: [
				{
					telegramId: '12345',
					firstName: 'Ada',
					lastName: 'Lovelace',
					username: 'ada',
					isBot: false,
				},
			],
		};
		mockCreateContact.mockResolvedValueOnce({ id: 'contact-ada' });
		mockUpsertMessages.mockResolvedValueOnce(1);
		await loadModule();

		await state.workerProcessor?.(pageJob());

		expect(mockCreateContact).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				firstName: 'Ada',
				lastName: 'Lovelace',
				sourceAccountId: SOURCE_ACCOUNT_ID,
				telegramId: '12345',
				username: 'ada',
			}),
			expect.any(Object),
		);
		expect(mockUpsertMessages).toHaveBeenCalledWith(
			WORKSPACE_ID,
			'44444444-4444-4444-8444-444444444444',
			[
				expect.objectContaining({
					contactId: 'contact-ada',
					telegramMessageId: '101',
				}),
			],
			expect.any(Object),
		);
		expect(mockLinkMessagesToContactsByTelegramIds).toHaveBeenCalledWith(
			WORKSPACE_ID,
			'44444444-4444-4444-8444-444444444444',
			[{ contactId: 'contact-ada', telegramMessageId: '101' }],
		);
	});

	it('defers newly inserted private messages by default instead of running local AI during import', async () => {
		state.contactRows = [
			{
				id: '55555555-5555-4555-8555-555555555555',
				telegramId: '123456',
				sourceAccountId: SOURCE_ACCOUNT_ID,
			},
		];
		state.messagesResult = {
			type: 'messages-result',
			messages: [
				{
					id: 101,
					text: 'I will send the deck tomorrow',
					date: 1771111111,
					isOutgoing: true,
				},
			],
			users: [],
		};
		mockListMessageIdsByTelegramIds.mockResolvedValueOnce([]);
		mockUpsertMessages.mockResolvedValueOnce(1);
		await loadModule();

		await state.workerProcessor?.(pageJob());

		expect(mockBufferMessage).not.toHaveBeenCalled();
		expect(mockScheduleKnowledgeAnalysis).not.toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			reason: 'small_sync',
			mode: 'incremental',
		});
	});

	it('buffers newly inserted private messages for local AI analysis when inline mode is enabled', async () => {
		state.contactRows = [
			{
				id: '55555555-5555-4555-8555-555555555555',
				telegramId: '123456',
				sourceAccountId: SOURCE_ACCOUNT_ID,
			},
		];
		state.messagesResult = {
			type: 'messages-result',
			messages: [
				{
					id: 101,
					text: 'I will send the deck tomorrow',
					date: 1771111111,
					isOutgoing: true,
				},
			],
			users: [],
		};
		mockListMessageIdsByTelegramIds
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ id: '66666666-6666-4666-8666-666666666666', telegramMessageId: '101' },
			]);
		mockUpsertMessages.mockResolvedValueOnce(1);
		await loadModule();

		await state.workerProcessor?.(pageJob(0, { localAnalysisMode: 'inline' }));

		expect(mockBufferMessage).toHaveBeenCalledWith(
			USER_ID,
			'55555555-5555-4555-8555-555555555555',
			WORKSPACE_ID,
			[
				expect.objectContaining({
					id: '66666666-6666-4666-8666-666666666666',
					role: 'user',
					content: 'encrypted:I will send the deck tomorrow',
					sourceMessageId: '66666666-6666-4666-8666-666666666666',
					chatId: '44444444-4444-4444-8444-444444444444',
					contactId: '55555555-5555-4555-8555-555555555555',
				}),
			],
			expect.objectContaining({
				encryptedWrk: expect.any(String),
				kmsContext: expect.any(Object),
				wrkVersion: 1,
			}),
			Buffer.alloc(32, 3).toString('hex'),
			'specific',
			SOURCE_ACCOUNT_ID,
		);
		expect(mockScheduleKnowledgeAnalysis).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			reason: 'small_sync',
			mode: 'incremental',
		});
	});

	it('does not buffer post-import AI analysis when AI consent is disabled', async () => {
		state.hasAiConsent = false;
		state.contactRows = [
			{
				id: '55555555-5555-4555-8555-555555555555',
				telegramId: '123456',
				sourceAccountId: SOURCE_ACCOUNT_ID,
			},
		];
		state.messagesResult = {
			type: 'messages-result',
			messages: [
				{
					id: 101,
					text: 'I will send the deck tomorrow',
					date: 1771111111,
					isOutgoing: true,
				},
			],
			users: [],
		};
		mockListMessageIdsByTelegramIds
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ id: '66666666-6666-4666-8666-666666666666', telegramMessageId: '101' },
			]);
		mockUpsertMessages.mockResolvedValueOnce(1);
		await loadModule();

		await state.workerProcessor?.(pageJob(0, { localAnalysisMode: 'inline' }));

		expect(mockHasUserAiAnalysisConsent).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID);
		expect(mockBufferMessage).not.toHaveBeenCalled();
		expect(mockScheduleKnowledgeAnalysis).not.toHaveBeenCalled();
	});

	it('queues incremental knowledge analysis and commitment discovery for touched contacts after a small recent import', async () => {
		state.runMessagesInserted = 42;
		const touchedContactIds = [
			'77777777-7777-4777-8777-777777777777',
			'88888888-8888-4888-8888-888888888888',
		];
		const touchedChatIds = ['99999999-9999-4999-8999-999999999999'];
		mockListContactIdsForTelegramImportRun
			.mockResolvedValueOnce(touchedContactIds)
			.mockResolvedValueOnce(touchedContactIds);
		mockListChatIdsForTelegramImportRun.mockResolvedValueOnce(touchedChatIds);
		mockQueueCommitmentReprocess.mockResolvedValueOnce({
			contactsProcessed: 2,
			messagesQueued: 16,
			batchSize: 200,
			contactLimit: 2,
			maxAgeDays: 7,
		});
		mockQueueIntroductionReprocess.mockResolvedValueOnce({
			chatsProcessed: 1,
			messagesQueued: 9,
			batchSize: 200,
			chatLimit: 1,
			maxAgeDays: 30,
		});
		mockQueueConnectionReprocess.mockResolvedValueOnce({
			contactsProcessed: 2,
			messagesQueued: 18,
			batchSize: 200,
			contactLimit: 2,
			maxAgeDays: 30,
		});
		await loadModule();

		await state.workerProcessor?.(pageJob());

		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'completed',
		);
		expect(mockScheduleKnowledgeAnalysis).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			reason: 'history_import_completed',
			mode: 'incremental',
			limit: 50,
			runId: RUN_ID,
		});
		expect(mockEnqueueHealthScoringForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, {
			force: true,
			reason: 'telegram_history_import_completed',
		});
		expect(mockListContactIdsForTelegramImportRun).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			runId: RUN_ID,
			limit: 100,
		});
		expect(mockListChatIdsForTelegramImportRun).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			runId: RUN_ID,
			limit: 100,
			chatTypes: ['group', 'supergroup'],
		});
		expect(mockQueueCommitmentReprocess).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			userId: USER_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			maxAgeDays: 7,
			contactLimit: 2,
			contactIds: touchedContactIds,
			batchSize: 200,
			skipWorkspaceRelationshipDerivation: true,
		});
		expect(mockQueueIntroductionReprocess).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			userId: USER_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			maxAgeDays: 30,
			chatLimit: 1,
			chatIds: touchedChatIds,
			batchSize: 200,
		});
		expect(mockQueueConnectionReprocess).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			userId: USER_ID,
			sourceAccountId: SOURCE_ACCOUNT_ID,
			maxAgeDays: 30,
			contactLimit: 2,
			contactIds: touchedContactIds,
			batchSize: 200,
		});
		expect(mockAppendAuditLog).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			actorType: 'system',
			actorId: USER_ID,
			action: 'generate',
			resourceType: 'message',
			metadata: expect.objectContaining({
				operation: 'telegram_import_auto_commitment_reprocess',
				runId: RUN_ID,
				contactsProcessed: 2,
				messagesQueued: 16,
				batchSize: 200,
				contactLimit: 2,
				touchedContactCount: 2,
				maxAgeDays: 7,
				sourceAccountFiltered: true,
			}),
		});
		expect(mockAppendAuditLog).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			actorType: 'system',
			actorId: USER_ID,
			action: 'generate',
			resourceType: 'message',
			metadata: expect.objectContaining({
				operation: 'telegram_import_auto_introduction_reprocess',
				runId: RUN_ID,
				chatsProcessed: 1,
				messagesQueued: 9,
				batchSize: 200,
				chatLimit: 1,
				touchedChatCount: 1,
				maxAgeDays: 30,
				sourceAccountFiltered: true,
			}),
		});
		expect(mockAppendAuditLog).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			actorType: 'system',
			actorId: USER_ID,
			action: 'generate',
			resourceType: 'message',
			metadata: expect.objectContaining({
				operation: 'telegram_import_auto_connection_reprocess',
				runId: RUN_ID,
				contactsProcessed: 2,
				messagesQueued: 18,
				batchSize: 200,
				contactLimit: 2,
				touchedContactCount: 2,
				maxAgeDays: 30,
				sourceAccountFiltered: true,
			}),
		});
	});

	it('queues full knowledge analysis after a backfill import with inserted history', async () => {
		state.runMessagesInserted = 42;
		await loadModule();

		await state.workerProcessor?.(pageJob(0, { importMode: 'backfill' }));

		expect(mockScheduleKnowledgeAnalysis).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			reason: 'history_import_completed',
			mode: 'full',
			runId: RUN_ID,
		});
	});

	it('does not run completed-import discovery when no new messages were inserted', async () => {
		state.runMessagesInserted = 0;
		await loadModule();

		await state.workerProcessor?.(pageJob());

		expect(mockScheduleKnowledgeAnalysis).not.toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			reason: 'history_import_completed',
			mode: 'full',
			runId: RUN_ID,
		});
		expect(mockQueueCommitmentReprocess).not.toHaveBeenCalled();
		expect(mockQueueIntroductionReprocess).not.toHaveBeenCalled();
		expect(mockQueueConnectionReprocess).not.toHaveBeenCalled();
		expect(mockAppendAuditLog).not.toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					operation: 'telegram_import_auto_commitment_reprocess',
				}),
			}),
		);
		expect(mockAppendAuditLog).not.toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					operation: 'telegram_import_auto_connection_reprocess',
				}),
			}),
		);
	});

	it('marks the run failed but still rejects on the final BullMQ attempt', async () => {
		state.hasConsent = false;
		await loadModule();

		await expect(state.workerProcessor?.(job(2))).rejects.toThrow(
			'Telegram import consent is required',
		);

		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'failed',
			expect.objectContaining({ errorCode: 'TELEGRAM_IMPORT_FAILED' }),
		);
	});

	it('does not overwrite a cancelled run with failed on the final BullMQ attempt', async () => {
		state.hasConsent = false;
		state.runStatuses = ['queued', 'cancelled'];
		await loadModule();

		await expect(state.workerProcessor?.(job(2))).rejects.toThrow(
			'Telegram import consent is required',
		);

		expect(mockUpdateTelegramImportRunStatus).not.toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'failed',
			expect.anything(),
		);
	});

	it('stores an actionable session-key failure without leaking the keychain marker', async () => {
		state.decryptError = new Error(
			'Command failed: security find-generic-password -a telegram-session:4da901a7-131d-4c70-86b6-6a99008f67b1:656f07d7-b526-46d8-938b-e8679d9d7557 -s gordian-v2 -w',
		);
		await loadModule();

		await expect(state.workerProcessor?.(job(2))).rejects.toThrow(
			'security find-generic-password -a [redacted] -s gordian-v2 -w',
		);

		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'failed',
			expect.objectContaining({
				errorCode: 'TELEGRAM_SESSION_KEY_UNAVAILABLE',
				errorMessage: expect.stringContaining('Could not read the local Telegram session key'),
			}),
		);
	});

	it('classifies Keychain helper status-code failures as session-key failures', async () => {
		state.decryptError = new Error(
			'macOS Keychain helper failed: SecItemCopyMatching failed with status -25293',
		);
		await loadModule();

		await expect(state.workerProcessor?.(job(2))).rejects.toThrow(
			'SecItemCopyMatching failed with status -25293',
		);

		expect(mockUpdateTelegramImportRunStatus).toHaveBeenCalledWith(
			WORKSPACE_ID,
			RUN_ID,
			'failed',
			expect.objectContaining({
				errorCode: 'TELEGRAM_SESSION_KEY_UNAVAILABLE',
				errorMessage: expect.stringContaining('Could not read the local Telegram session key'),
			}),
		);
	});
});
