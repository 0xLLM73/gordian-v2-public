import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be defined before imports
// ---------------------------------------------------------------------------

const mockUpsertChat = vi.fn();
const mockUpsertMessages = vi.fn();
const mockLinkMessagesToContact = vi.fn();
const mockLinkMessagesToContactsByTelegramIds = vi.fn();
const mockListMessageIdsByTelegramIds = vi.fn();
const mockUpdateChatLastSync = vi.fn();
const mockCreateContact = vi.fn();
const mockUpdateContact = vi.fn();
const mockBufferMessage = vi.fn();

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
const CONTACTS_TABLE = {
	id: 'id',
	workspaceId: 'workspace_id',
	telegramId: 'telegram_id',
	username: 'username',
};

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
		linkMessagesToContact: mockLinkMessagesToContact,
		linkMessagesToContactsByTelegramIds: mockLinkMessagesToContactsByTelegramIds,
		listMessageIdsByTelegramIds: mockListMessageIdsByTelegramIds,
		updateChatLastSync: mockUpdateChatLastSync,
		createContact: mockCreateContact,
		updateContact: mockUpdateContact,
		listChats: vi.fn(),
		createTokenMention: vi.fn(() => Promise.resolve({ id: 'tm-1' })),
		incrementMentionCount: vi.fn(() => Promise.resolve()),
		getActiveGoalsByType: vi.fn(() => Promise.resolve([])),
		updateGoalProgress: vi.fn(() => Promise.resolve()),
		autoPauseOnReply: vi.fn(() => Promise.resolve([])),
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

vi.mock('../message-buffer', () => ({
	bufferMessage: mockBufferMessage,
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

const mockRelationshipQueueAdd = vi.fn();
vi.mock('../relationship-extraction', () => ({
	relationshipExtractionQueue: { add: mockRelationshipQueueAdd },
	relationshipExtractionWorker: { on: vi.fn() },
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
		process.env.NODE_ENV = 'test';
		Reflect.deleteProperty(process.env, 'TELEGRAM_ALLOW_SESSION_UNWRAP_OUTSIDE_IMPORTS');
		mockLinkMessagesToContact.mockResolvedValue(0);
		mockLinkMessagesToContactsByTelegramIds.mockResolvedValue(0);
		mockListMessageIdsByTelegramIds.mockImplementation(
			(_workspaceId: string, _chatId: string, telegramMessageIds: string[]) =>
				Promise.resolve(
					telegramMessageIds.map((telegramMessageId) => ({
						id: `msg-db-${telegramMessageId}`,
						telegramMessageId,
					})),
				),
		);
		mockUpdateContact.mockResolvedValue({ id: 'contact-uuid-1' });
	});

	describe('personal-account sync scope', () => {
		it('blocks stored session unwrap outside imports in local runtime mode', async () => {
			process.env.NODE_ENV = 'development';
			mockSendToUser.mockResolvedValue({ type: 'contacts-result', contacts: [] });

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await expect(
				processor({
					data: { userId: 'user-1', workspaceId: 'ws-1' },
				}),
			).rejects.toThrow(/restricted to history imports/);
			expect(mockConnectUser).not.toHaveBeenCalled();
		});

		it('contacts-only sync does not fetch dialogs, messages, or backfill history', async () => {
			mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
				if (msg.type === 'get-contacts') {
					return { type: 'contacts-result', contacts: [] };
				}
				throw new Error(`unexpected GramJS call: ${String(msg.type)}`);
			});

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1' },
			});

			expect(mockSendToUser).toHaveBeenCalledTimes(1);
			expect(mockSendToUser).toHaveBeenCalledWith('user-1', { type: 'get-contacts' });
			expect(mockUpsertMessages).not.toHaveBeenCalled();

			const { backfillQueue } = await import('../backfill');
			expect(backfillQueue.add).not.toHaveBeenCalled();
		});

		it('private-recent sync ignores group dialogs', async () => {
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
							{
								chatId: 'group-1',
								type: 'group',
								title: 'Group',
								topMessage: 200,
								unreadCount: 0,
								participantCount: 10,
								isBot: false,
							},
						],
					};
				}
				if (msg.type === 'get-messages') {
					return { type: 'messages-result', messages: [] };
				}
				throw new Error(`unexpected GramJS call: ${String(msg.type)}`);
			});
			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-1',
				workspaceId: 'ws-1',
				telegramChatId: '100',
				lastSyncAt: null,
			});

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
			});

			expect(mockSendToUser).not.toHaveBeenCalledWith(
				'user-1',
				expect.objectContaining({ type: 'get-participants' }),
			);
			expect(mockUpsertChat).toHaveBeenCalledTimes(1);
		});

		it('explicit group sync imports recent group dialogs and small-group participants', async () => {
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
							{
								chatId: 'group-1',
								type: 'group',
								title: 'Group',
								topMessage: 200,
								unreadCount: 0,
								participantCount: 10,
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
								telegramId: '200',
								firstName: 'Group',
								lastName: 'Member',
								username: 'group_member',
								isBot: false,
							},
						],
					};
				}
				if (msg.type === 'get-messages') {
					return { type: 'messages-result', messages: [] };
				}
				throw new Error(`unexpected GramJS call: ${String(msg.type)}`);
			});
			mockCreateContact.mockResolvedValue({ id: 'contact-group-member' });
			mockUpsertChat.mockImplementation((_workspaceId: string, input: { telegramChatId: string }) =>
				Promise.resolve({
					id: `chat-${input.telegramChatId}`,
					workspaceId: 'ws-1',
					telegramChatId: input.telegramChatId,
					lastSyncAt: null,
				}),
			);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: {
					userId: 'user-1',
					workspaceId: 'ws-1',
					syncScope: 'private_recent_with_groups',
				},
			});

			expect(mockSendToUser).toHaveBeenCalledWith('user-1', {
				type: 'get-participants',
				chatId: 'group-1',
				chatType: 'group',
			});
			expect(mockUpsertChat).toHaveBeenCalledWith(
				'ws-1',
				expect.objectContaining({ telegramChatId: 'group-1', type: 'group' }),
				expect.anything(),
			);
			expect(mockUpsertChat).toHaveBeenCalledTimes(2);
		});
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
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
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
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
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
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
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
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
			});

			await new Promise((r) => setTimeout(r, 0));
			await new Promise((r) => setTimeout(r, 0));

			const { autoPauseOnReply } = await import('@repo/db');
			expect(autoPauseOnReply).not.toHaveBeenCalled();
		});
	});

	describe('GramJS response mapping', () => {
		it('passes existing private peer username to updateContact', async () => {
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
								firstName: 'Alice',
								lastName: '',
								username: 'alice_existing',
								topMessage: 100,
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

			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-1',
				workspaceId: 'ws-1',
				telegramChatId: '100',
				lastSyncAt: null,
			});

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
			});

			expect(mockUpdateContact).toHaveBeenCalledWith(
				'ws-1',
				'contact-uuid-1',
				expect.objectContaining({ username: 'alice_existing' }),
				expect.anything(),
			);
		});

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
				telegramChatId: '100',
				lastSyncAt: null,
			});
			mockUpsertMessages.mockResolvedValue(2);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: { userId: 'user-1', workspaceId: 'ws-1', syncScope: 'private_recent' },
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
						contactId: 'contact-uuid-1', // No senderId in a private chat → dialog peer
						isOutgoing: true,
					}),
				]),
				expect.anything(),
			);
			expect(mockLinkMessagesToContact).toHaveBeenCalledWith(
				'ws-1',
				'chat-uuid-1',
				'contact-uuid-1',
			);
		});

		it('creates contacts from message sender users and repairs duplicate group rows', async () => {
			mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
				if (msg.type === 'get-contacts') {
					return { type: 'contacts-result', contacts: [] };
				}
				if (msg.type === 'get-dialogs') {
					return {
						type: 'dialogs-result',
						dialogs: [
							{
								chatId: 'group-123',
								type: 'supergroup',
								title: 'Large Group',
								participantCount: 200,
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
							{
								id: 10,
								text: 'Group update',
								date: 1700000000,
								senderId: '300',
								isOutgoing: false,
							},
						],
						users: [
							{
								telegramId: '300',
								firstName: 'Grace',
								lastName: 'Hopper',
								username: 'grace',
								isBot: false,
							},
						],
					};
				}
				return {};
			});
			mockCreateContact.mockResolvedValueOnce({ id: 'contact-grace' });
			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-group',
				workspaceId: 'ws-1',
				telegramChatId: 'group-123',
				lastSyncAt: null,
			});
			mockUpsertMessages.mockResolvedValue(0);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

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
					firstName: 'Grace',
					lastName: 'Hopper',
					sourceAccountId: '999999',
					telegramId: '300',
					username: 'grace',
				}),
				expect.anything(),
			);
			expect(mockUpsertMessages).toHaveBeenCalledWith(
				'ws-1',
				'chat-uuid-group',
				[
					expect.objectContaining({
						contactId: 'contact-grace',
						telegramMessageId: '10',
					}),
				],
				expect.anything(),
			);
			expect(mockLinkMessagesToContactsByTelegramIds).toHaveBeenCalledWith(
				'ws-1',
				'chat-uuid-group',
				[{ contactId: 'contact-grace', telegramMessageId: '10' }],
			);
		});

		it('buffers live AI messages with DB message ids when available', async () => {
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
							{
								id: 123,
								text: 'We are investing in Solana infra',
								date: 1700000000,
								senderId: '100',
								isOutgoing: false,
							},
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
			mockListMessageIdsByTelegramIds.mockResolvedValue([
				{ id: 'db-message-uuid-1', telegramMessageId: '123' },
			]);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: {
					userId: 'user-1',
					workspaceId: 'ws-1',
					syncScope: 'private_recent',
					enableAiProcessing: true,
				},
			});

			expect(mockListMessageIdsByTelegramIds).toHaveBeenCalledWith('ws-1', 'chat-uuid-1', ['123']);
			expect(mockBufferMessage).toHaveBeenCalledWith(
				'user-1',
				'contact-uuid-1',
				'ws-1',
				[
					expect.objectContaining({
						id: 'db-message-uuid-1',
						content: 'enc:We are investing in Solana infra',
					}),
				],
				expect.anything(),
				expect.any(String),
				undefined,
				'999999',
			);
		});

		it('buffers live AI messages without message ids when DB identity lookup misses', async () => {
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
							{
								id: 124,
								text: 'DeFi liquidity came up',
								date: 1700000000,
								senderId: '100',
								isOutgoing: false,
							},
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
			mockListMessageIdsByTelegramIds.mockResolvedValue([]);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: {
					userId: 'user-1',
					workspaceId: 'ws-1',
					syncScope: 'private_recent',
					enableAiProcessing: true,
				},
			});

			const bufferedMessages = mockBufferMessage.mock.calls[0]?.[3] as Array<{ id?: string }>;
			expect(bufferedMessages[0]?.id).toBeUndefined();
		});
	});

	describe('group intro extraction batches', () => {
		it('buffers only newly inserted private overlap messages for AI', async () => {
			const lastSync = new Date('2026-05-14T10:00:00Z');

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
								topMessage: 101,
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
							{
								id: 10,
								text: 'Overlap from prior sync',
								date: Math.floor(lastSync.getTime() / 1000) - 1,
								senderId: '100',
								isOutgoing: false,
							},
							{
								id: 11,
								text: 'New intro-relevant message',
								date: Math.floor(lastSync.getTime() / 1000) + 3,
								senderId: '100',
								isOutgoing: false,
							},
						],
					};
				}
				return {};
			});

			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-private',
				workspaceId: 'ws-1',
				telegramChatId: '100',
				lastSyncAt: lastSync,
			});
			mockUpsertMessages.mockResolvedValue(1);
			mockListMessageIdsByTelegramIds.mockResolvedValue([
				{ id: 'message-uuid-10', telegramMessageId: '10' },
				{ id: 'message-uuid-11', telegramMessageId: '11' },
			]);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: {
					userId: 'user-1',
					workspaceId: 'ws-1',
					syncScope: 'private_recent',
					enableAiProcessing: true,
				},
			});

			expect(mockBufferMessage).toHaveBeenCalledWith(
				'user-1',
				'contact-uuid-1',
				'ws-1',
				[
					expect.objectContaining({
						sourceMessageId: 'message-uuid-11',
						content: 'enc:New intro-relevant message',
					}),
				],
				expect.anything(),
				expect.any(String),
				undefined,
				'999999',
			);
			const bufferedMessages = mockBufferMessage.mock.calls[0]?.[3];
			expect(bufferedMessages).toHaveLength(1);
			expect(bufferedMessages).not.toEqual(
				expect.arrayContaining([expect.objectContaining({ sourceMessageId: 'message-uuid-10' })]),
			);
		});

		it('queues group messages with persisted source message IDs', async () => {
			mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
				if (msg.type === 'get-contacts') {
					return { type: 'contacts-result', contacts: [] };
				}
				if (msg.type === 'get-dialogs') {
					return {
						type: 'dialogs-result',
						dialogs: [
							{
								chatId: 'group-123',
								type: 'supergroup',
								title: 'Founders',
								participantCount: 200,
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
							{
								id: 10,
								text: 'Alice, meet Bob. Bob, Alice is building the fund.',
								date: 1700000000,
								senderId: '100',
								isOutgoing: false,
							},
						],
					};
				}
				return {};
			});

			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-group',
				workspaceId: 'ws-1',
				telegramChatId: 'group-123',
				lastSyncAt: null,
			});
			mockUpsertMessages.mockResolvedValue(1);
			mockListMessageIdsByTelegramIds.mockResolvedValue([
				{ id: 'message-uuid-10', telegramMessageId: '10' },
			]);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: {
					userId: 'user-1',
					workspaceId: 'ws-1',
					syncScope: 'private_recent_with_groups',
					enableAiProcessing: true,
				},
			});

			expect(mockRelationshipQueueAdd).toHaveBeenCalledWith(
				'extract-relationships',
				expect.objectContaining({
					workspaceId: 'ws-1',
					sourceAccountId: '999999',
					chatId: 'chat-uuid-group',
					chatType: 'supergroup',
					workspaceSalt: expect.any(String),
					messages: [
						expect.objectContaining({
							sourceMessageId: 'message-uuid-10',
							chatId: 'chat-uuid-group',
							contactId: 'contact-uuid-1',
							content: 'enc:Alice, meet Bob. Bob, Alice is building the fund.',
						}),
					],
				}),
				expect.objectContaining({ attempts: 2 }),
			);
		});

		it('does not queue duplicate overlap group messages for intro extraction', async () => {
			const lastSync = new Date('2026-05-14T10:00:00Z');

			mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
				if (msg.type === 'get-contacts') {
					return { type: 'contacts-result', contacts: [] };
				}
				if (msg.type === 'get-dialogs') {
					return {
						type: 'dialogs-result',
						dialogs: [
							{
								chatId: 'group-123',
								type: 'supergroup',
								title: 'Founders',
								participantCount: 200,
								topMessage: 101,
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
							{
								id: 10,
								text: 'Overlap: Alice, meet Bob.',
								date: Math.floor(lastSync.getTime() / 1000) - 1,
								senderId: '100',
								isOutgoing: false,
							},
							{
								id: 11,
								text: 'New: Bob, Carol is building the fund.',
								date: Math.floor(lastSync.getTime() / 1000) + 3,
								senderId: '100',
								isOutgoing: false,
							},
						],
					};
				}
				return {};
			});

			mockUpsertChat.mockResolvedValue({
				id: 'chat-uuid-group',
				workspaceId: 'ws-1',
				telegramChatId: 'group-123',
				lastSyncAt: lastSync,
			});
			mockUpsertMessages.mockResolvedValue(1);
			mockListMessageIdsByTelegramIds.mockResolvedValue([
				{ id: 'message-uuid-10', telegramMessageId: '10' },
				{ id: 'message-uuid-11', telegramMessageId: '11' },
			]);

			await import('../sync');
			const processor = (globalThis as Record<string, unknown>).__syncProcessor as (job: {
				data: Record<string, unknown>;
			}) => Promise<void>;

			await processor({
				data: {
					userId: 'user-1',
					workspaceId: 'ws-1',
					syncScope: 'private_recent_with_groups',
					enableAiProcessing: true,
				},
			});

			expect(mockRelationshipQueueAdd).toHaveBeenCalledWith(
				'extract-relationships',
				expect.objectContaining({
					sourceAccountId: '999999',
					messages: [
						expect.objectContaining({
							sourceMessageId: 'message-uuid-11',
							content: 'enc:New: Bob, Carol is building the fund.',
						}),
					],
				}),
				expect.objectContaining({ attempts: 2 }),
			);
			const queuedMessages = mockRelationshipQueueAdd.mock.calls[0]?.[1]?.messages;
			expect(queuedMessages).toHaveLength(1);
			expect(queuedMessages).not.toEqual(
				expect.arrayContaining([expect.objectContaining({ sourceMessageId: 'message-uuid-10' })]),
			);
		});
	});
});
