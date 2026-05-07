import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

vi.mock('bullmq', () => ({
	Queue: vi.fn(function MockQueue() {
		return { add: vi.fn(), on: vi.fn() };
	}),
	FlowProducer: vi.fn(function MockFlowProducer() {
		return {
			add: vi.fn().mockResolvedValue({ id: 'flow-1' }),
		};
	}),
	Worker: vi.fn(function MockWorker(_name: string, processor: unknown) {
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
vi.mock('@repo/db', () => ({
	isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('@repo/crypto', () => ({
	unwrapWrk: vi.fn().mockResolvedValue(Buffer.alloc(32)),
	deriveKeys: vi
		.fn()
		.mockResolvedValue({ dek: Buffer.alloc(32), bik: Buffer.alloc(32), tsk: Buffer.alloc(32) }),
	decrypt: vi.fn((content: string) => content),
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

// ─── FlowProducer — 5th child job ────────────────────────────────────────────

describe('scheduleAIPipeline — knowledge-extraction as 5th child', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		flowProducerInstance.add.mockResolvedValue({ id: 'flow-job-1' });
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

	it('relationship-extraction child passes only workspaceId, contactId, keyEnvelope', async () => {
		const { scheduleAIPipeline } = await import('../ai-flow');
		await scheduleAIPipeline(USER, CONTACT, WS, fakeKeyEnvelope, fakeMessages);

		const call = flowProducerInstance.add.mock.calls[0]?.[0];
		const relChild = call?.children?.find(
			(c: { queueName: string }) => c.queueName === 'relationship-extraction',
		);
		expect(relChild).toBeDefined();
		expect(relChild?.name).toBe('extract-relationships');
		expect(relChild?.prefix).toBe('{ai-flow}');
		expect(relChild?.data).toEqual({
			workspaceId: WS,
			contactId: CONTACT,
			keyEnvelope: fakeKeyEnvelope,
		});
	});
});

// ─── Knowledge extraction worker — feature flag + message guard ───────────────

describe('knowledge extraction worker processor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
});
