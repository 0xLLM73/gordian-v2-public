import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateContact = vi.fn();
const mockUpsertChat = vi.fn();
const mockUpsertMessages = vi.fn();
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
		upsertChat: mockUpsertChat,
		upsertMessages: mockUpsertMessages,
		updateChatLastSync: mockUpdateChatLastSync,
		getActiveGoalsByType: vi.fn(() => Promise.resolve([])),
		updateGoalProgress: vi.fn(() => Promise.resolve()),
		autoPauseOnReply: vi.fn(() => Promise.resolve([])),
		createTokenMention: vi.fn(() => Promise.resolve({ id: 'tm-1' })),
		incrementMentionCount: vi.fn(() => Promise.resolve()),
		trackAnalyticsEvent: vi.fn(),
		hasAnalyticsConsent: vi.fn(() => Promise.resolve(false)),
		getCalibration: vi.fn(() => Promise.resolve(null)),
		updateContactRecency: vi.fn(() => Promise.resolve()),
		getStaleContacts: vi.fn(() => Promise.resolve([])),
		withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	};
});

vi.mock('bullmq', () => ({
	Queue: vi.fn(function MockQueue() {
		return {
			add: vi.fn(),
			name: 'sync',
		};
	}),
	Worker: vi.fn(function MockWorker(_name: string, processor: unknown) {
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
		mockUpsertChat.mockResolvedValue({
			id: 'chat-1',
			workspaceId: 'ws-1',
			telegramChatId: '12345',
			lastSyncAt: null,
		});
		mockUpsertMessages.mockResolvedValue(0);
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
			data: { userId: 'user-1', workspaceId: 'ws-1' },
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
			data: { userId: 'user-1', workspaceId: 'ws-1' },
		});

		expect(mockCreateContact).not.toHaveBeenCalled();
	});
});
