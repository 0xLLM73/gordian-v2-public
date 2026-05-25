import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ACCOUNT_ID = '6790809932';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

const state = vi.hoisted(() => ({
	rlsDepth: 0,
	lockDepth: 0,
	hasConsent: true,
	decryptError: null as Error | null,
	getMessagesError: null as Error | null,
	messagesResult: {
		type: 'messages-result',
		messages: [] as Array<Record<string, unknown>>,
		users: [] as Array<Record<string, unknown>>,
	},
	contactRows: [] as Array<Record<string, unknown>>,
	dialogs: [] as Array<Record<string, unknown>>,
	importState: null as null | {
		historyComplete: boolean;
		nextOffsetMessageId: number;
		newestImportedMessageId: number | null;
	},
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
const mockGetOldestTelegramMessageId = vi.hoisted(() => vi.fn());
const mockHasCurrentTelegramConsent = vi.hoisted(() => vi.fn());
const mockHasOpenTelegramImportChats = vi.hoisted(() => vi.fn());
const mockUpdateTelegramImportDiscoveryCounts = vi.hoisted(() => vi.fn());
const mockUpdateTelegramImportRunChatStatus = vi.hoisted(() => vi.fn());
const mockUpdateTelegramImportRunStatus = vi.hoisted(() => vi.fn());
const mockUpsertChat = vi.hoisted(() => vi.fn());
const mockCreateContact = vi.hoisted(() => vi.fn());
const mockLinkMessagesToContact = vi.hoisted(() => vi.fn());
const mockLinkMessagesToContactsByTelegramIds = vi.hoisted(() => vi.fn());
const mockUpsertMessages = vi.hoisted(() => vi.fn());
const mockUpsertTelegramImportRunChat = vi.hoisted(() => vi.fn());
const mockWithWorkspaceRLS = vi.hoisted(() => vi.fn());

const DATA = {
	runId: RUN_ID,
	userId: USER_ID,
	workspaceId: WORKSPACE_ID,
	sourceAccountId: SOURCE_ACCOUNT_ID,
};

vi.mock('bullmq', () => ({
	Queue: vi.fn(() => ({ add: mockQueueAdd })),
	Worker: vi.fn((_name: string, processor: (job: unknown) => Promise<unknown>) => {
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
}));

vi.mock('@repo/shared', () => ({
	TELEGRAM_CONSENT_VERSION: 1,
	redactSensitive: (value: unknown) =>
		String(value).replace(/\btelegram-session:[0-9a-f-]{36}(?::[0-9a-f-]{36})?\b/gi, '[redacted]'),
}));

vi.mock('@repo/db', () => {
	const db = {
		select: vi.fn((selection: Record<string, unknown>) => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
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
				})),
			})),
		})),
	};
	db.select.mockImplementation((selection: Record<string, unknown>) => ({
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
	mockHasCurrentTelegramConsent.mockImplementation(async () => state.hasConsent);
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
		contacts: {},
		createContact: mockCreateContact,
		db,
		eq: vi.fn(),
		failTelegramImportRunChat: mockFailTelegramImportRunChat,
		getOldestTelegramMessageId: mockGetOldestTelegramMessageId,
		getTelegramChatImportState: mockGetTelegramChatImportState,
		getTelegramImportRun: mockGetTelegramImportRun,
		getTelegramImportRunChat: mockGetTelegramImportRunChat,
		hasCurrentTelegramConsent: mockHasCurrentTelegramConsent,
		hasOpenTelegramImportChats: mockHasOpenTelegramImportChats,
		isNull: vi.fn(),
		linkMessagesToContact: mockLinkMessagesToContact,
		linkMessagesToContactsByTelegramIds: mockLinkMessagesToContactsByTelegramIds,
		or: vi.fn(),
		recordTelegramImportPage: vi.fn(),
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

function job(attemptsMade = 0) {
	return {
		attemptsMade,
		data: DATA,
		opts: { attempts: 3 },
	};
}

function pageJob(attemptsMade = 0) {
	return {
		attemptsMade,
		data: {
			...DATA,
			runChatId: '33333333-3333-4333-8333-333333333333',
		},
		opts: { attempts: 3 },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	state.rlsDepth = 0;
	state.lockDepth = 0;
	state.hasConsent = true;
	state.decryptError = null;
	state.getMessagesError = null;
	state.messagesResult = { type: 'messages-result', messages: [], users: [] };
	state.contactRows = [];
	state.dialogs = [];
	state.importState = null;
	state.runChatType = 'private';
	state.runChatNextOffsetMessageId = 100;
	state.runStatuses = [];
	state.decryptStates = [];
	state.sendMessages = [];
	state.sendStates = [];
	state.workerProcessor = undefined;
	mockCreateContact.mockResolvedValue({ id: 'created-contact-id' });
	mockLinkMessagesToContact.mockResolvedValue(0);
	mockLinkMessagesToContactsByTelegramIds.mockResolvedValue(0);
	mockUpsertMessages.mockResolvedValue(0);
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

	it('keeps keychain decrypt and Telegram discovery outside RLS transactions', async () => {
		await loadModule();

		await state.workerProcessor?.(job());

		expect(state.decryptStates).toEqual([{ rlsDepth: 0, lockDepth: 0 }]);
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
				newerThanMessageId: 100,
			}),
			expect.objectContaining({ delay: expect.any(Number) }),
		);
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
});
