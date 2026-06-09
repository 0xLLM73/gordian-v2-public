import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateContact = vi.fn();
const mockUpdateContact = vi.fn();
const mockUpsertChat = vi.fn();
const mockUpsertMessages = vi.fn();
const mockListMessageIdsByTelegramIds = vi.fn();
const mockUpdateChatLastSync = vi.fn();

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	keyStore: {
		getStore: vi.fn(() => ({
			dek: Buffer.alloc(32),
			bik: Buffer.alloc(32),
			tsk: Buffer.alloc(32),
		})),
	},
	unwrapWrk: vi.fn(() => Promise.resolve(Buffer.alloc(32))),
	deriveKeys: vi.fn(() =>
		Promise.resolve({ dek: Buffer.alloc(32), bik: Buffer.alloc(32), tsk: Buffer.alloc(32) }),
	),
	encrypt: vi.fn((content: string) => `enc:${content}`),
	decrypt: vi.fn((content: string) => content),
	decryptSessionKek: vi.fn(() => Promise.resolve(Buffer.alloc(32))),
}));

/**
 * db.select() handles three shapes:
 * - accounts query → accessToken + accountId
 * - workspaces query → envelope row
 * - contacts query → existing contacts for dedup map
 */
const ACCOUNTS_TABLE = {
	id: 'id',
	userId: 'user_id',
	providerId: 'provider_id',
	accessToken: 'access_token',
	accountId: 'account_id',
	sessionKekEncrypted: 'session_kek_encrypted',
};
const WORKSPACES_TABLE = {
	id: 'id',
	encryptedWrk: 'encrypted_wrk',
	kmsContext: 'kms_context',
	wrkVersion: 'wrk_version',
};
const CONTACTS_TABLE = { id: 'id', workspaceId: 'workspace_id', telegramId: 'telegram_id' };

const MY_TG_ID = '999999';

vi.mock('@repo/db', () => {
	const mockFrom = vi.fn((table: unknown) => {
		if (table === ACCOUNTS_TABLE) {
			const accountResult = Object.assign(
				[
					{
						accessToken: 'enc:mock-session',
						accountId: MY_TG_ID,
						sessionKekEncrypted: Buffer.from('mock-kek-blob'),
					},
				],
				{
					limit: vi.fn(() => [
						{
							accessToken: 'enc:mock-session',
							accountId: MY_TG_ID,
							sessionKekEncrypted: Buffer.from('mock-kek-blob'),
						},
					]),
				},
			);
			return { where: vi.fn(() => accountResult) };
		}

		// contacts / workspaces
		const whereResult = Object.assign(
			[], // no pre-existing contacts
			{
				limit: vi.fn(() => [
					{
						encryptedWrk: Buffer.from('test').toString('base64'),
						kmsContext: { workspaceId: 'ws-1' },
						wrkVersion: 1,
					},
				]),
			},
		);
		return { where: vi.fn(() => whereResult) };
	});

	return {
		db: { select: vi.fn(() => ({ from: mockFrom })) },
		eq: vi.fn(),
		and: vi.fn(),
		accounts: ACCOUNTS_TABLE,
		workspaces: WORKSPACES_TABLE,
		contacts: CONTACTS_TABLE,
		createContact: mockCreateContact,
		updateContact: mockUpdateContact,
		upsertChat: mockUpsertChat,
		upsertMessages: mockUpsertMessages,
		listMessageIdsByTelegramIds: mockListMessageIdsByTelegramIds,
		updateChatLastSync: mockUpdateChatLastSync,
		updateMessageSenderMetadataByTelegramIds: vi.fn(() => Promise.resolve(0)),
		getActiveGoalsByType: vi.fn(() => Promise.resolve([])),
		updateGoalProgress: vi.fn(() => Promise.resolve()),
		autoPauseOnReply: vi.fn(() => Promise.resolve([])),
		createTokenMention: vi.fn(() => Promise.resolve({ id: 'tm-1' })),
		incrementMentionCount: vi.fn(() => Promise.resolve()),
		trackAnalyticsEvent: vi.fn(),
		hasAnalyticsConsent: vi.fn(() => Promise.resolve(false)),
		getCalibration: vi.fn(() =>
			Promise.resolve({
				commitmentSensitivity: undefined,
				consentAiAnalysis: true,
				priorityContactIds: [],
			}),
		),
		updateContactRecency: vi.fn(() => Promise.resolve()),
		getStaleContacts: vi.fn(() => Promise.resolve([])),
		withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	};
});

vi.mock('bullmq', () => ({
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Queue: vi.fn().mockImplementation(function () {
		return {
			add: vi.fn(),
			name: 'sync',
		};
	}),
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Worker: vi.fn().mockImplementation(function (_name: string, processor: unknown) {
		(globalThis as Record<string, unknown>).__syncSourceProcessor = processor;
		return { on: vi.fn() };
	}),
}));

const mockSendToUser = vi.fn();
const mockConnectUser = vi.fn();
vi.mock('../../gramjs/thread', () => ({
	sendToUser: mockSendToUser,
	connectUser: mockConnectUser,
}));

vi.mock('../../realtime/broadcast', () => ({
	broadcastSyncComplete: vi.fn(() => Promise.resolve()),
	broadcastSyncProgress: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../telegram-config', () => ({
	isTelegramFullBackfillEnabled: vi.fn(() => false),
	isTelegramPeriodicSyncEnabled: vi.fn(() => false),
}));

vi.mock('../ai-flow', () => ({
	scheduleAIPipeline: vi.fn(),
	aiFlowProducer: { add: vi.fn() },
	orchestratorWorker: { on: vi.fn() },
	extractionWorker: { on: vi.fn() },
	embeddingsWorker: { on: vi.fn() },
	summaryWorker: { on: vi.fn() },
}));

vi.mock('../backfill', () => ({
	backfillQueue: { add: vi.fn() },
	backfillWorker: { on: vi.fn() },
}));

vi.mock('../../ai/token-detection', () => ({
	detectTokenMentions: vi.fn(() => Promise.resolve([])),
	hasTokenKeywords: vi.fn(() => false),
}));

vi.mock('../../redis', () => ({ connection: {} }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

type SyncProcessor = (job: { data: Record<string, unknown> }) => Promise<void>;

describe('sync sourceAccountId threading', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateContact.mockResolvedValue({ id: 'ct-new-1' });
		mockUpdateContact.mockResolvedValue({ id: 'ct-existing-1' });
		mockUpsertChat.mockResolvedValue({
			id: 'chat-1',
			workspaceId: 'ws-1',
			telegramChatId: '12345',
			lastSyncAt: null,
		});
		mockUpsertMessages.mockResolvedValue(0);
		mockListMessageIdsByTelegramIds.mockResolvedValue([]);
	});

	it('passes sourceAccountId from job data to createContact', async () => {
		mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
			if (msg.type === 'get-contacts') {
				return {
					type: 'contacts-result',
					contacts: [{ telegramId: 'tg-alice', firstName: 'Alice', lastName: '', phone: '' }],
				};
			}
			if (msg.type === 'get-dialogs') {
				return { type: 'dialogs-result', dialogs: [] };
			}
			return {};
		});

		await import('../sync');
		const processor = (globalThis as Record<string, unknown>)
			.__syncSourceProcessor as SyncProcessor;

		await processor({
			data: { userId: 'user-1', workspaceId: 'ws-1', sourceAccountId: 'custom-account-id' },
		});

		expect(mockCreateContact).toHaveBeenCalledWith(
			'ws-1',
			expect.objectContaining({ sourceAccountId: 'custom-account-id' }),
			expect.anything(),
		);
	});

	it('falls back to myTelegramId when sourceAccountId not in job data', async () => {
		mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
			if (msg.type === 'get-contacts') {
				return {
					type: 'contacts-result',
					contacts: [{ telegramId: 'tg-bob', firstName: 'Bob', lastName: '', phone: '' }],
				};
			}
			if (msg.type === 'get-dialogs') {
				return { type: 'dialogs-result', dialogs: [] };
			}
			return {};
		});

		await import('../sync');
		const processor = (globalThis as Record<string, unknown>)
			.__syncSourceProcessor as SyncProcessor;

		await processor({
			data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
		});

		// MY_TG_ID is returned by getTelegramAccount → accountId
		expect(mockCreateContact).toHaveBeenCalledWith(
			'ws-1',
			expect.objectContaining({ sourceAccountId: MY_TG_ID }),
			expect.anything(),
		);
	});

	it('does not call createContact for already-existing contacts', async () => {
		mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
			if (msg.type === 'get-contacts') {
				// telegramId '100' is already in the contactMap (from CONTACTS_TABLE mock)
				return {
					type: 'contacts-result',
					contacts: [],
				};
			}
			if (msg.type === 'get-dialogs') {
				return { type: 'dialogs-result', dialogs: [] };
			}
			return {};
		});

		await import('../sync');
		const processor = (globalThis as Record<string, unknown>)
			.__syncSourceProcessor as SyncProcessor;

		await processor({
			data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
		});

		expect(mockCreateContact).not.toHaveBeenCalled();
	});

	it('passes Telegram contact username to createContact', async () => {
		mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
			if (msg.type === 'get-contacts') {
				return {
					type: 'contacts-result',
					contacts: [
						{
							telegramId: 'tg-alice',
							firstName: 'Alice',
							lastName: '',
							phone: '',
							username: 'alice_tg',
						},
					],
				};
			}
			if (msg.type === 'get-dialogs') {
				return { type: 'dialogs-result', dialogs: [] };
			}
			return {};
		});

		await import('../sync');
		const processor = (globalThis as Record<string, unknown>)
			.__syncSourceProcessor as SyncProcessor;

		await processor({
			data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
		});

		expect(mockCreateContact).toHaveBeenCalledWith(
			'ws-1',
			expect.objectContaining({ telegramId: 'tg-alice', username: 'alice_tg' }),
			expect.anything(),
		);
	});

	it('passes private peer username to createContact', async () => {
		mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
			if (msg.type === 'get-contacts') {
				return { type: 'contacts-result', contacts: [] };
			}
			if (msg.type === 'get-dialogs') {
				return {
					type: 'dialogs-result',
					dialogs: [
						{
							chatId: 'tg-peer',
							type: 'private',
							firstName: 'Peer',
							lastName: '',
							username: 'peer_handle',
							topMessage: 10,
							unreadCount: 0,
							isBot: false,
						},
					],
				};
			}
			if (msg.type === 'get-messages') {
				return { type: 'messages-result', messages: [] };
			}
			return {};
		});

		await import('../sync');
		const processor = (globalThis as Record<string, unknown>)
			.__syncSourceProcessor as SyncProcessor;

		await processor({
			data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
		});

		expect(mockUpsertChat).toHaveBeenCalledWith(
			'ws-1',
			expect.objectContaining({ telegramChatId: 'tg-peer', sourceAccountId: MY_TG_ID }),
			expect.anything(),
		);
		expect(mockCreateContact).toHaveBeenCalledWith(
			'ws-1',
			expect.objectContaining({ telegramId: 'tg-peer', username: 'peer_handle' }),
			expect.anything(),
		);
	});

	it('passes group participant username to createContact', async () => {
		mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
			if (msg.type === 'get-contacts') {
				return { type: 'contacts-result', contacts: [] };
			}
			if (msg.type === 'get-dialogs') {
				return {
					type: 'dialogs-result',
					dialogs: [
						{
							chatId: 'group-1',
							type: 'group',
							title: 'Founders',
							participantCount: 2,
							topMessage: 10,
							unreadCount: 0,
							isBot: false,
						},
					],
				};
			}
			if (msg.type === 'get-participants') {
				return {
					type: 'participants-result',
					participants: [
						{
							telegramId: 'tg-participant',
							firstName: 'Pat',
							lastName: '',
							username: 'participant_handle',
							isBot: false,
						},
					],
				};
			}
			if (msg.type === 'get-messages') {
				return { type: 'messages-result', messages: [] };
			}
			return {};
		});

		await import('../sync');
		const processor = (globalThis as Record<string, unknown>)
			.__syncSourceProcessor as SyncProcessor;

		await processor({
			data: {
				userId: 'user-1',
				workspaceId: 'ws-1',
				syncScope: 'private_recent_with_groups',
			},
		});

		expect(mockCreateContact).toHaveBeenCalledWith(
			'ws-1',
			expect.objectContaining({
				telegramId: 'tg-participant',
				username: 'participant_handle',
			}),
			expect.anything(),
		);
	});
});
