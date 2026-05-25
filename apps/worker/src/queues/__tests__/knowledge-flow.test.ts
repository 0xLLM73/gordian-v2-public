import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

const mockFlowProducerAdd = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'flow-1' }));
const mockQueueAdd = vi.hoisted(() => vi.fn());
const mockWorkerProcessors = vi.hoisted(() => new Map<string, unknown>());

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation((name: string) => ({
		add: mockQueueAdd,
		name,
		getJobCounts: vi.fn(),
	})),
	FlowProducer: vi.fn().mockImplementation(() => ({
		add: mockFlowProducerAdd,
	})),
	Worker: vi.fn().mockImplementation((name: string, processor: unknown) => {
		mockWorkerProcessors.set(name, processor);
		return {
			processor,
			on: vi.fn(),
		};
	}),
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

const mockExtractKnowledgeEntities = vi.fn();
vi.mock('../../ai/knowledge-extraction', () => ({
	extractKnowledgeEntities: mockExtractKnowledgeEntities,
}));

// P8: Mock commitment heuristics (dependency of commitment-extraction via ai-flow)
vi.mock('../../ai/commitment-heuristics', () => ({
	checkCommitmentHeuristic: () => ({ matched: false, pattern: '', confidence: 0 }),
}));

const mockIsFeatureEnabled = vi.fn();
const mockHasWorkspaceAiAnalysisConsent = vi.hoisted(() => vi.fn());
const mockHasUserAiAnalysisConsent = vi.hoisted(() => vi.fn());
const mockDbSelectFrom = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn(() => ({ from: mockDbSelectFrom })));
const mockCreateContact = vi.hoisted(() => vi.fn());
const mockGetCalibration = vi.hoisted(() => vi.fn());
const mockLinkMessagesToContact = vi.hoisted(() => vi.fn());
const mockLinkMessagesToContactsByTelegramIds = vi.hoisted(() => vi.fn());
const mockListMessageIdsByTelegramIds = vi.hoisted(() => vi.fn());
const mockUpdateChatLastSync = vi.hoisted(() => vi.fn());
const mockUpsertChat = vi.hoisted(() => vi.fn());
const mockUpsertMessages = vi.hoisted(() => vi.fn());
const mockUpdateContactRecency = vi.hoisted(() => vi.fn());
const mockTrackAnalyticsEvent = vi.hoisted(() => vi.fn());

const ACCOUNTS_TABLE = vi.hoisted(() => ({
	accessToken: 'access_token',
	accountId: 'account_id',
	providerId: 'provider_id',
	sessionKekEncrypted: 'session_kek_encrypted',
	userId: 'user_id',
}));
const WORKSPACES_TABLE = vi.hoisted(() => ({
	encryptedWrk: 'encrypted_wrk',
	id: 'id',
	kmsContext: 'kms_context',
	wrkVersion: 'wrk_version',
}));
const CONTACTS_TABLE = vi.hoisted(() => ({
	id: 'id',
	telegramId: 'telegram_id',
	workspaceId: 'workspace_id',
}));

vi.mock('@repo/db', () => ({
	accounts: ACCOUNTS_TABLE,
	and: vi.fn(),
	autoPauseOnReply: vi.fn(() => Promise.resolve([])),
	contacts: CONTACTS_TABLE,
	createContact: mockCreateContact,
	createTokenMention: vi.fn(() => Promise.resolve({ id: 'token-mention-1' })),
	db: {
		select: mockDbSelect,
	},
	eq: vi.fn(),
	getActiveGoalsByType: vi.fn(() => Promise.resolve([])),
	getCalibration: mockGetCalibration,
	getStaleContacts: vi.fn(() => Promise.resolve([])),
	hasAnalyticsConsent: vi.fn(() => Promise.resolve(false)),
	hasUserAiAnalysisConsent: mockHasUserAiAnalysisConsent,
	hasWorkspaceAiAnalysisConsent: mockHasWorkspaceAiAnalysisConsent,
	incrementMentionCount: vi.fn(() => Promise.resolve()),
	isFeatureEnabled: mockIsFeatureEnabled,
	linkMessagesToContact: mockLinkMessagesToContact,
	linkMessagesToContactsByTelegramIds: mockLinkMessagesToContactsByTelegramIds,
	listMessageIdsByTelegramIds: mockListMessageIdsByTelegramIds,
	trackAnalyticsEvent: mockTrackAnalyticsEvent,
	updateChatLastSync: mockUpdateChatLastSync,
	updateContactRecency: mockUpdateContactRecency,
	updateGoalProgress: vi.fn(() => Promise.resolve()),
	upsertChat: mockUpsertChat,
	upsertMessages: mockUpsertMessages,
	withWorkspaceRLS: vi.fn((_workspaceId: string, fn: () => unknown) => fn()),
	workspaces: WORKSPACES_TABLE,
}));

vi.mock('@repo/crypto', () => ({
	decrypt: vi.fn((content: string) => content),
	decryptSessionKek: vi.fn(() => Promise.resolve(Buffer.alloc(32))),
	encrypt: vi.fn((content: string) => `enc:${content}`),
	unwrapWrk: vi.fn().mockResolvedValue(Buffer.alloc(32)),
	deriveKeys: vi
		.fn()
		.mockResolvedValue({ dek: Buffer.alloc(32), bik: Buffer.alloc(32), tsk: Buffer.alloc(32) }),
}));

const mockSendToUser = vi.hoisted(() => vi.fn());
const mockConnectUser = vi.hoisted(() => vi.fn());
const mockCanRunCloudCommitmentIntelligence = vi.hoisted(() => vi.fn(() => true));
const mockCanRunCommitmentExtraction = vi.hoisted(() => vi.fn(() => true));
const mockCanRunEmbeddingGeneration = vi.hoisted(() => vi.fn(() => true));
const mockIsVendorAiEgressEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../gramjs/thread', () => ({
	connectUser: mockConnectUser,
	sendToUser: mockSendToUser,
}));

vi.mock('../../realtime/broadcast', () => ({
	broadcastSyncComplete: vi.fn(() => Promise.resolve()),
	broadcastSyncProgress: vi.fn(() => Promise.resolve()),
	broadcastUpdate: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../ai/token-detection', () => ({
	detectTokenMentions: vi.fn(() => Promise.resolve([])),
	hasTokenKeywords: vi.fn(() => false),
}));

vi.mock('../../ai/deal-detection', () => ({
	detectDealSignals: vi.fn(() => ({ matchedKeywords: [], passed: false, tier: 1 })),
}));

vi.mock('../deal-detection', () => ({
	dealDetectionQueue: { add: vi.fn() },
	dealDetectionWorker: { on: vi.fn() },
}));

const mockBufferMessage = vi.hoisted(() => vi.fn());
vi.mock('../message-buffer', () => ({
	bufferMessage: mockBufferMessage,
}));

vi.mock('../backfill', () => ({
	backfillQueue: { add: vi.fn() },
	backfillWorker: { on: vi.fn() },
}));

vi.mock('../../telegram-config', () => ({
	isTelegramFullBackfillEnabled: vi.fn(() => false),
	isTelegramPeriodicSyncEnabled: vi.fn(() => false),
}));

vi.mock('@repo/shared', () => ({
	canRunCloudCommitmentIntelligence: mockCanRunCloudCommitmentIntelligence,
	canRunCommitmentExtraction: mockCanRunCommitmentExtraction,
	canRunEmbeddingGeneration: mockCanRunEmbeddingGeneration,
	getCommitmentLlmRuntime: vi.fn(() => ({ mode: 'cloud', provider: 'cloud' })),
	isVendorAiEgressEnabled: mockIsVendorAiEgressEnabled,
	redactSensitive: vi.fn((value: unknown) => String(value)),
	resolveTelegramSyncScope: vi.fn((scope?: string) => scope ?? 'contacts_only'),
}));

// ─── Side-effect imports (triggers Worker/FlowProducer registration) ──────────

await import('../knowledge-extraction');
await import('../ai-flow');

// ─── Extract processor and FlowProducer.add from mocks ───────────────────────

const { Worker, FlowProducer } = await import('bullmq');

// knowledge-extraction worker processor (1st Worker call)
const knowledgeWorkerCalls = vi.mocked(Worker).mock.calls;
const knowledgeProcessorFn = knowledgeWorkerCalls[0]?.[1] as (job: {
	data: Record<string, unknown>;
}) => Promise<unknown>;

// FlowProducer.add mock (from scheduleAIPipeline)
const flowProducerInstance = vi.mocked(FlowProducer).mock.results[0]?.value as {
	add: ReturnType<typeof vi.fn>;
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const CONTACT = 'contact-00000000-0000-0000-0000-000000000001';
const USER = 'user-00000000-0000-0000-0000-000000000001';

const fakeKeyEnvelope = {
	encryptedWrk: Buffer.from('key').toString('base64'),
	kmsContext: { workspaceId: WS },
	wrkVersion: 1,
};

const fakeMessages = [
	{ role: 'user', content: 'encrypted-content', timestamp: '2026-02-20T00:00:00Z' },
];
const fakeMessagesWithIds = [
	{
		id: 'db-message-uuid-1',
		role: 'user',
		content: 'encrypted-content',
		timestamp: '2026-02-20T00:00:00Z',
	},
];

// ─── FlowProducer — 5th child job ────────────────────────────────────────────

describe('scheduleAIPipeline — knowledge-extraction as 5th child', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCanRunCloudCommitmentIntelligence.mockReturnValue(true);
		mockCanRunCommitmentExtraction.mockReturnValue(true);
		mockCanRunEmbeddingGeneration.mockReturnValue(true);
		mockIsVendorAiEgressEnabled.mockReturnValue(true);
		flowProducerInstance.add.mockResolvedValue({ id: 'flow-job-1' });
		mockHasUserAiAnalysisConsent.mockResolvedValue(true);
	});

	it('adds all child jobs including style-analysis', async () => {
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		expect(call?.children).toHaveLength(9);
	});

	it('includes knowledge-extraction as the 5th child with correct queueName', async () => {
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		const knowledgeChild = call?.children?.find(
			(c: { queueName: string }) => c.queueName === 'knowledge-extraction',
		);
		expect(knowledgeChild).toBeDefined();
		expect(knowledgeChild?.name).toBe('extract-knowledge');
	});

	it('knowledge-extraction child uses prefix {ai-flow}', async () => {
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		const knowledgeChild = call?.children?.find(
			(c: { queueName: string }) => c.queueName === 'knowledge-extraction',
		);
		expect(knowledgeChild?.prefix).toBe('{ai-flow}');
	});

	it('sets cleanup options on parent and child flow jobs', async () => {
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		expect(call?.opts).toMatchObject({
			removeOnComplete: true,
			removeOnFail: { count: 50, age: 3600 },
		});
		for (const child of call?.children ?? []) {
			expect(child.opts).toMatchObject({
				removeOnComplete: true,
				removeOnFail: { count: 50, age: 3600 },
			});
		}
	});

	it('knowledge-extraction child receives the same job data as other children', async () => {
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS, fakeKeyEnvelope, fakeMessages);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		const knowledgeChild = call?.children?.find(
			(c: { queueName: string }) => c.queueName === 'knowledge-extraction',
		);
		expect(knowledgeChild?.data).toMatchObject({
			contactId: CONTACT,
			workspaceId: WS,
			userId: USER,
		});
	});

	it('orchestrator parent uses prefix {ai-flow} and queueName "orchestrator"', async () => {
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		expect(call?.prefix).toBe('{ai-flow}');
		expect(call?.queueName).toBe('orchestrator');
	});

	it('all original 5 child queues are still present', async () => {
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		const queueNames = call?.children?.map((c: { queueName: string }) => c.queueName);
		expect(queueNames).toContain('extraction');
		expect(queueNames).toContain('embeddings');
		expect(queueNames).toContain('summaries');
		expect(queueNames).toContain('fulfillment');
		expect(queueNames).toContain('relationship-extraction');
	});

	it('omits cloud commitment children when local-only mode disables vendor commitment intelligence', async () => {
		mockCanRunCloudCommitmentIntelligence.mockReturnValue(false);
		mockCanRunCommitmentExtraction.mockReturnValue(false);
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		const queueNames = call?.children?.map((c: { queueName: string }) => c.queueName);
		expect(queueNames).not.toContain('extraction');
		expect(queueNames).not.toContain('fulfillment');
		expect(queueNames).toContain('embeddings');
		expect(queueNames).toContain('knowledge-extraction');
	});

	it('schedules local Qwen commitment extraction without cloud fulfillment', async () => {
		mockCanRunCloudCommitmentIntelligence.mockReturnValue(false);
		mockCanRunCommitmentExtraction.mockReturnValue(true);
		mockCanRunEmbeddingGeneration.mockReturnValue(true);
		mockIsVendorAiEgressEnabled.mockReturnValue(false);
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		const queueNames = call?.children?.map((c: { queueName: string }) => c.queueName);
		expect(queueNames).toContain('extraction');
		expect(queueNames).not.toContain('fulfillment');
		expect(queueNames).not.toContain('summaries');
		expect(queueNames).not.toContain('relationship-extraction');
		expect(queueNames).not.toContain('goal-extraction');
		expect(queueNames).toContain('embeddings');
		expect(queueNames).toContain('knowledge-extraction');
	});

	it('extraction worker skips before consent and decrypt when no commitment provider is available', async () => {
		mockCanRunCommitmentExtraction.mockReturnValue(false);
		const extractionProcessor = mockWorkerProcessors.get('extraction') as
			| ((job: { data: Record<string, unknown> }) => Promise<unknown>)
			| undefined;
		if (!extractionProcessor) throw new Error('extraction worker processor was not registered');

		const result = await extractionProcessor({
			data: {
				contactId: CONTACT,
				workspaceId: WS,
				userId: USER,
				keyEnvelope: fakeKeyEnvelope,
				messages: fakeMessages,
			},
		});

		expect(result).toEqual({
			skipped: true,
			reason: 'commitment_extraction_disabled',
		});
		expect(mockHasUserAiAnalysisConsent).not.toHaveBeenCalled();
	});

	it('fails closed when user AI consent is not persisted', async () => {
		mockHasUserAiAnalysisConsent.mockResolvedValue(false);
		const { scheduleAIPipeline } = await import('../ai-flow');

		await expect(scheduleAIPipeline(USER, CONTACT, WS)).rejects.toThrow(/AI analysis consent/);
		expect(flowProducerInstance.add).not.toHaveBeenCalled();
	});

	it('relationship-extraction child receives fresh batch context and source metadata', async () => {
		const { scheduleAIPipeline } = await import('../ai-flow');
		const fakeSalt = Buffer.from('salt').toString('hex');
		await scheduleAIPipeline(
			USER,
			CONTACT,
			WS,
			fakeKeyEnvelope,
			fakeMessages,
			fakeSalt,
			undefined,
			'tg-account-1',
		);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		const relChild = call?.children?.find(
			(c: { queueName: string }) => c.queueName === 'relationship-extraction',
		);
		expect(relChild).toBeDefined();
		expect(relChild?.name).toBe('extract-relationships');
		expect(relChild?.prefix).toBe('{ai-flow}');
		expect(relChild?.data).toEqual({
			workspaceId: WS,
			userId: USER,
			sourceAccountId: 'tg-account-1',
			contactId: CONTACT,
			keyEnvelope: fakeKeyEnvelope,
			messages: fakeMessages,
			workspaceSalt: fakeSalt,
		});
	});
});

// ─── Knowledge extraction worker — feature flag + message guard ───────────────

describe('knowledge extraction worker processor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockHasWorkspaceAiAnalysisConsent.mockResolvedValue(true);
	});

	it('skips processing when feature flag "knowledge_extraction" is disabled', async () => {
		mockIsFeatureEnabled.mockResolvedValue(false);

		await knowledgeProcessorFn({
			data: {
				contactId: CONTACT,
				workspaceId: WS,
				messages: fakeMessages,
				keyEnvelope: fakeKeyEnvelope,
			},
		});

		expect(mockIsFeatureEnabled).toHaveBeenCalledWith('knowledge_extraction', WS);
		expect(mockExtractKnowledgeEntities).not.toHaveBeenCalled();
	});

	it('skips when messages array is empty', async () => {
		await knowledgeProcessorFn({
			data: { contactId: CONTACT, workspaceId: WS, messages: [] },
		});

		expect(mockExtractKnowledgeEntities).not.toHaveBeenCalled();
	});

	it('skips when messages field is absent', async () => {
		await knowledgeProcessorFn({
			data: { contactId: CONTACT, workspaceId: WS },
		});

		expect(mockExtractKnowledgeEntities).not.toHaveBeenCalled();
	});

	it('calls extractKnowledgeEntities when feature flag is enabled and messages present', async () => {
		mockIsFeatureEnabled.mockResolvedValue(true);
		mockExtractKnowledgeEntities.mockResolvedValue(undefined);

		const fakeSaltHex = Buffer.from('test-salt').toString('hex');
		await knowledgeProcessorFn({
			data: {
				contactId: CONTACT,
				workspaceId: WS,
				messages: fakeMessages,
				workspaceSalt: fakeSaltHex,
				keyEnvelope: fakeKeyEnvelope,
			},
		});

		expect(mockExtractKnowledgeEntities).toHaveBeenCalledTimes(1);
		expect(mockExtractKnowledgeEntities).toHaveBeenCalledWith(
			expect.any(Array), // decrypted texts
			CONTACT,
			WS,
			expect.any(Buffer), // workspaceSalt
			expect.objectContaining({ wrkVersion: 1 }), // SealedEnvelope
		);
	});

	it('preserves DB message ids when passing live queue messages to extraction', async () => {
		mockIsFeatureEnabled.mockResolvedValue(true);
		mockExtractKnowledgeEntities.mockResolvedValue(undefined);

		const fakeSaltHex = Buffer.from('test-salt').toString('hex');
		await knowledgeProcessorFn({
			data: {
				contactId: CONTACT,
				workspaceId: WS,
				messages: fakeMessagesWithIds,
				workspaceSalt: fakeSaltHex,
				keyEnvelope: fakeKeyEnvelope,
			},
		});

		expect(mockExtractKnowledgeEntities).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					id: 'db-message-uuid-1',
					text: 'encrypted-content',
					timestamp: '2026-02-20T00:00:00Z',
				}),
			],
			CONTACT,
			WS,
			expect.any(Buffer),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});
});

// ─── Sync gating — AI consent + KG extraction enqueue ────────────────────────

function setupSyncDbMocks() {
	mockDbSelectFrom.mockImplementation((table: unknown) => {
		if (table === ACCOUNTS_TABLE) {
			const accountRows = Object.assign(
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
			return { where: vi.fn(() => accountRows) };
		}

		if (table === WORKSPACES_TABLE) {
			const workspaceRows = Object.assign([], {
				limit: vi.fn(() => [
					{
						encryptedWrk: Buffer.from('workspace-key').toString('base64'),
						kmsContext: { workspaceId: WS },
						wrkVersion: 1,
					},
				]),
			});
			return { where: vi.fn(() => workspaceRows) };
		}

		if (table === CONTACTS_TABLE) {
			return {
				where: vi.fn(() => [
					{
						id: CONTACT,
						telegramId: '100',
					},
				]),
			};
		}

		return { where: vi.fn(() => []) };
	});
}

function setupPrivateSyncWithOneMessage() {
	mockSendToUser.mockImplementation((_userId: string, msg: Record<string, unknown>) => {
		if (msg.type === 'get-contacts') {
			return { contacts: [], type: 'contacts-result' };
		}
		if (msg.type === 'get-dialogs') {
			return {
				dialogs: [
					{
						chatId: '100',
						firstName: 'Ada',
						isBot: false,
						topMessage: 100,
						type: 'private',
						unreadCount: 0,
					},
				],
				type: 'dialogs-result',
			};
		}
		if (msg.type === 'get-messages') {
			return {
				messages: [
					{
						date: 1_770_000_000,
						id: 123,
						isOutgoing: false,
						senderId: '100',
						text: 'We should research Ethereum infrastructure this week',
					},
				],
				type: 'messages-result',
			};
		}
		throw new Error(`unexpected GramJS call: ${String(msg.type)}`);
	});
	mockUpsertChat.mockResolvedValue({
		id: 'chat-1',
		lastSyncAt: null,
		telegramChatId: '100',
		workspaceId: WS,
	});
	mockUpsertMessages.mockResolvedValue(1);
	mockLinkMessagesToContact.mockResolvedValue(0);
	mockLinkMessagesToContactsByTelegramIds.mockResolvedValue(0);
	mockListMessageIdsByTelegramIds.mockResolvedValue([
		{ id: 'message-1', telegramMessageId: '123' },
	]);
	mockUpdateChatLastSync.mockResolvedValue(undefined);
	mockUpdateContactRecency.mockResolvedValue(undefined);
}

async function getSyncProcessor() {
	await import('../sync');
	const processor = mockWorkerProcessors.get('sync') as
		| ((job: { data: Record<string, unknown> }) => Promise<void>)
		| undefined;
	if (!processor) throw new Error('sync worker processor was not registered');
	return processor;
}

describe('sync AI/KG extraction gating', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupSyncDbMocks();
		setupPrivateSyncWithOneMessage();
		mockConnectUser.mockResolvedValue(undefined);
		mockGetCalibration.mockResolvedValue({
			commitmentSensitivity: undefined,
			consentAiAnalysis: true,
			priorityContactIds: [],
		});
	});

	it('does not buffer AI/KG extraction when sync disables AI processing', async () => {
		const processor = await getSyncProcessor();

		await processor({
			data: {
				enableAiProcessing: false,
				syncScope: 'private_recent',
				userId: USER,
				workspaceId: WS,
			},
		});

		expect(mockBufferMessage).not.toHaveBeenCalled();
	});

	it('does not buffer AI/KG extraction without persisted AI analysis consent', async () => {
		mockGetCalibration.mockResolvedValue({
			commitmentSensitivity: undefined,
			consentAiAnalysis: false,
			priorityContactIds: [],
		});
		const processor = await getSyncProcessor();

		await processor({
			data: {
				enableAiProcessing: true,
				syncScope: 'private_recent',
				userId: USER,
				workspaceId: WS,
			},
		});

		expect(mockGetCalibration).toHaveBeenCalledWith(USER, WS, expect.any(Object));
		expect(mockBufferMessage).not.toHaveBeenCalled();
	});
});
