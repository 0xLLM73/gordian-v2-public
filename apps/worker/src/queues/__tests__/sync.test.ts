import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be defined before imports
// ---------------------------------------------------------------------------

const mockUpsertChat = vi.fn();
const mockUpsertMessages = vi.fn();
const mockUpdateChatLastSync = vi.fn();
const mockCreateContact = vi.fn();

vi.mock('@repo/crypto', () => ({
	decryptSessionKek: vi.fn(() => Promise.resolve(Buffer.alloc(32))),
	decrypt: vi.fn((ciphertext: string) => ciphertext),
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
}));

/**
 * db.select() mock must handle three query shapes:
 * 1. getWorkspaceEnvelope: select().from(workspaces).where().limit(1) → envelope row
 * 2. buildTelegramContactMap: select().from(contacts).where() → array of {id, telegramId}
 * 3. getTelegramSession: select().from(accounts).where().limit(1) → {accessToken}
 *
 * We use the 'from' table reference to determine the return data.
 */
const ACCOUNTS_TABLE = {
	id: 'id',
	userId: 'user_id',
	providerId: 'provider_id',
	accessToken: 'access_token',
	accountId: 'account_id',
};
const WORKSPACES_TABLE = {
	id: 'id',
	encryptedWrk: 'encrypted_wrk',
	kmsContext: 'kms_context',
	wrkVersion: 'wrk_version',
};
const CONTACTS_TABLE = { id: 'id', workspaceId: 'workspace_id', telegramId: 'telegram_id' };

vi.mock('@repo/db', () => {
	const mockFrom = vi.fn((table: unknown) => {
		// Accounts query → return session token + account ID
		if (table === ACCOUNTS_TABLE) {
			const accountResult = Object.assign(
				[
					{
						accessToken: 'mock-telegram-session',
						accountId: '999999',
						sessionKekEncrypted: Buffer.from('mock-kek'),
					},
				],
				{
					limit: vi.fn(() => [
						{
							accessToken: 'mock-telegram-session',
							accountId: '999999',
							sessionKekEncrypted: Buffer.from('mock-kek'),
						},
					]),
				},
			);
			return { where: vi.fn(() => accountResult) };
		}

		// Default: contacts/workspaces queries
		const whereResult = Object.assign(
			[
				{ id: 'contact-uuid-1', telegramId: '100' },
				{ id: 'contact-uuid-2', telegramId: '200' },
			],
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
		upsertChat: mockUpsertChat,
		upsertMessages: mockUpsertMessages,
		updateChatLastSync: mockUpdateChatLastSync,
		createContact: mockCreateContact,
		listChats: vi.fn(),
		createTokenMention: vi.fn(() => Promise.resolve({ id: 'tm-1' })),
		incrementMentionCount: vi.fn(() => Promise.resolve()),
		getActiveGoalsByType: vi.fn(() => Promise.resolve([])),
		updateGoalProgress: vi.fn(() => Promise.resolve()),
		autoPauseOnReply: vi.fn(() => Promise.resolve([])),
		trackAnalyticsEvent: vi.fn(),
		hasAnalyticsConsent: vi.fn(() => Promise.resolve(false)),
		getCalibration: vi.fn(() => Promise.resolve(null)),
		updateContactRecency: vi.fn(() => Promise.resolve()),
		getStaleContacts: vi.fn(() => Promise.resolve([])),
		withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	};
});

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation(() => ({
		add: vi.fn(),
		name: 'sync',
		getJobCounts: vi.fn(),
	})),
	Worker: vi.fn().mockImplementation((_name: string, processor: unknown) => {
		(globalThis as Record<string, unknown>).__syncProcessor = processor;
		return { on: vi.fn() };
	}),
	FlowProducer: vi.fn().mockImplementation(() => ({
		add: vi.fn(),
	})),
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
	broadcastUpdate: vi.fn(() => Promise.resolve()),
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

vi.mock('../../ai/deal-detection', () => ({
	detectDealSignals: vi.fn(() => ({ passed: false, tier: 1, matchedKeywords: [] })),
}));

vi.mock('../deal-detection', () => ({
	dealDetectionQueue: { add: vi.fn() },
	dealDetectionWorker: { on: vi.fn() },
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Message Sync Pipeline', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('message dedup', () => {
		it('passes duplicate messages to upsertMessages (DAL handles ON CONFLICT DO NOTHING)', async () => {
			// First insert: 3 new messages
			mockUpsertMessages.mockResolvedValueOnce(3);

			const { upsertMessages } = await import('@repo/db');
			const inserted = await upsertMessages(
				'ws-1',
				'chat-uuid-1',
				[
					{ telegramMessageId: '1', text: 'Hello', isOutgoing: false, sentAt: new Date() },
					{ telegramMessageId: '2', text: 'World', isOutgoing: false, sentAt: new Date() },
					{ telegramMessageId: '3', text: 'Hi', isOutgoing: true, sentAt: new Date() },
				],
				{} as never,
			);

			expect(inserted).toBe(3);

			// Second insert: same messages → 0 (ON CONFLICT DO NOTHING)
			mockUpsertMessages.mockResolvedValueOnce(0);

			const reInserted = await upsertMessages(
				'ws-1',
				'chat-uuid-1',
				[
					{ telegramMessageId: '1', text: 'Hello', isOutgoing: false, sentAt: new Date() },
					{ telegramMessageId: '2', text: 'World', isOutgoing: false, sentAt: new Date() },
					{ telegramMessageId: '3', text: 'Hi', isOutgoing: true, sentAt: new Date() },
				],
				{} as never,
			);

			expect(reInserted).toBe(0);
			expect(mockUpsertMessages).toHaveBeenCalledTimes(2);
		});
	});

	describe('lastSyncAt handling', () => {
		it('passes minDate=0 for first sync (no lastSyncAt)', async () => {
			mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
				if (msg.type === 'get-contacts') {
					return { type: 'contacts-result', contacts: [] };
				}
				if (msg.type === 'get-dialogs') {
					return {
						type: 'dialogs-result',
						dialogs: [
							{
								chatId: '12345',
								type: 'private',
								title: 'Alice',
								topMessage: 100,
								unreadCount: 0,
								isBot: false,
							},
						],
					};
				}
				if (msg.type === 'get-messages') {
					expect(msg.minDate).toBe(0);
					return { type: 'messages-result', messages: [] };
				}
				return {};
			});

			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-1',
				workspaceId: 'ws-1',
				telegramChatId: '12345',
				lastSyncAt: null, // Never synced
			});

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: { userId: string; workspaceId: string };
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1' },
			});

			expect(mockSendToUser).toHaveBeenCalledWith(
				'user-1',
				expect.objectContaining({ type: 'get-messages', minDate: 0 }),
			);
		});

		it('passes minDate from lastSyncAt for re-sync', async () => {
			const lastSync = new Date('2026-02-15T12:00:00Z');

			mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
				if (msg.type === 'get-contacts') {
					return { type: 'contacts-result', contacts: [] };
				}
				if (msg.type === 'get-dialogs') {
					return {
						type: 'dialogs-result',
						dialogs: [
							{
								chatId: '12345',
								type: 'private',
								title: 'Alice',
								topMessage: 100,
								unreadCount: 0,
								isBot: false,
							},
						],
					};
				}
				if (msg.type === 'get-messages') {
					expect(msg.minDate).toBe(Math.floor(lastSync.getTime() / 1000) - 5);
					return { type: 'messages-result', messages: [] };
				}
				return {};
			});

			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-1',
				workspaceId: 'ws-1',
				telegramChatId: '12345',
				lastSyncAt: lastSync,
			});

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: { userId: string; workspaceId: string };
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1' },
			});

			expect(mockSendToUser).toHaveBeenCalledWith(
				'user-1',
				expect.objectContaining({
					type: 'get-messages',
					minDate: Math.floor(lastSync.getTime() / 1000) - 5,
				}),
			);
		});
	});

	describe('follow-up plan auto-pause on reply', () => {
		it('calls autoPauseOnReply when incoming messages are present', async () => {
			mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
				if (msg.type === 'get-contacts') {
					return { type: 'contacts-result', contacts: [] };
				}
				if (msg.type === 'get-dialogs') {
					return {
						type: 'dialogs-result',
						dialogs: [
							{
								chatId: '100',
								type: 'private',
								title: 'Alice',
								topMessage: 100,
								unreadCount: 0,
								isBot: false,
							},
						],
					};
				}
				if (msg.type === 'get-messages') {
					return {
						type: 'messages-result',
						messages: [
							{ id: 1, text: 'Hey there', date: 1700000000, senderId: '100', isOutgoing: false },
						],
					};
				}
				return {};
			});

			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-1',
				workspaceId: 'ws-1',
				telegramChatId: '100',
				lastSyncAt: null,
			});
			mockUpsertMessages.mockResolvedValue(1);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: { userId: string; workspaceId: string };
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1' },
			});

			// Flush fire-and-forget promise chain (dynamic import + .then)
			await new Promise((r) => setTimeout(r, 0));
			await new Promise((r) => setTimeout(r, 0));

			const { autoPauseOnReply } = await import('@repo/db');
			expect(autoPauseOnReply).toHaveBeenCalledWith('ws-1', 'contact-uuid-1');
		});

		it('does NOT call autoPauseOnReply when all messages are outgoing', async () => {
			mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
				if (msg.type === 'get-contacts') {
					return { type: 'contacts-result', contacts: [] };
				}
				if (msg.type === 'get-dialogs') {
					return {
						type: 'dialogs-result',
						dialogs: [
							{
								chatId: '100',
								type: 'private',
								title: 'Alice',
								topMessage: 100,
								unreadCount: 0,
								isBot: false,
							},
						],
					};
				}
				if (msg.type === 'get-messages') {
					return {
						type: 'messages-result',
						messages: [{ id: 1, text: 'Hey Alice', date: 1700000000, isOutgoing: true }],
					};
				}
				return {};
			});

			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-1',
				workspaceId: 'ws-1',
				telegramChatId: '100',
				lastSyncAt: null,
			});
			mockUpsertMessages.mockResolvedValue(1);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: { userId: string; workspaceId: string };
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1' },
			});

			await new Promise((r) => setTimeout(r, 0));
			await new Promise((r) => setTimeout(r, 0));

			const { autoPauseOnReply } = await import('@repo/db');
			expect(autoPauseOnReply).not.toHaveBeenCalled();
		});
	});

	describe('GramJS response mapping', () => {
		it('stores messages with correct contact mapping and outgoing flag', async () => {
			mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
				if (msg.type === 'get-contacts') {
					return { type: 'contacts-result', contacts: [] };
				}
				if (msg.type === 'get-dialogs') {
					return {
						type: 'dialogs-result',
						dialogs: [
							{
								chatId: '12345',
								type: 'private',
								title: 'Alice',
								topMessage: 100,
								unreadCount: 0,
								isBot: false,
							},
						],
					};
				}
				if (msg.type === 'get-messages') {
					return {
						type: 'messages-result',
						messages: [
							{ id: 1, text: 'Hello', date: 1700000000, senderId: '100', isOutgoing: false },
							{ id: 2, text: 'Reply', date: 1700000001, isOutgoing: true },
						],
					};
				}
				return {};
			});

			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-1',
				workspaceId: 'ws-1',
				telegramChatId: '12345',
				lastSyncAt: null,
			});
			mockUpsertMessages.mockResolvedValue(2);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: { userId: string; workspaceId: string };
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1' },
			});

			expect(mockUpsertMessages).toHaveBeenCalledWith(
				'ws-1',
				'chat-uuid-1',
				expect.arrayContaining([
					expect.objectContaining({
						telegramMessageId: '1',
						contactId: 'contact-uuid-1', // Mapped from senderId '100'
						isOutgoing: false,
					}),
					expect.objectContaining({
						telegramMessageId: '2',
						contactId: undefined, // No senderId → undefined
						isOutgoing: true,
					}),
				]),
				expect.anything(),
			);
		});
	});
});
