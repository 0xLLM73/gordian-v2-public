import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GI4 — Goal Extraction Worker Tests
 *
 * Verifies:
 * - Decryption of messages from BullMQ payload (SEC-006)
 * - Confidence filtering (< 0.4 skipped)
 * - Dedup via blind index (isDuplicateGoal)
 * - ELM masking on extracted titles (SEC-122)
 * - Proposal storage via createGoalProposal
 * - No-op when no messages, no envelope, or no goals found
 */

// ─── Hoisted mocks ──────────────────────────────────────────────────────────────

const mockUnwrapWrk = vi.hoisted(() => vi.fn());
const mockDeriveKeys = vi.hoisted(() => vi.fn());
const mockDecrypt = vi.hoisted(() => vi.fn());
const mockMaskEntities = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());
const mockExtractGoals = vi.hoisted(() => vi.fn());
const mockIsDuplicateGoal = vi.hoisted(() => vi.fn());
const mockCreateGoalProposal = vi.hoisted(() => vi.fn());
const mockCreateCommitment = vi.hoisted(() => vi.fn());
const mockCreateMemory = vi.hoisted(() => vi.fn());
const mockUpsertSummary = vi.hoisted(() => vi.fn());
const mockHasUserAiAnalysisConsent = vi.hoisted(() => vi.fn());
const mockTrackAnalyticsEvent = vi.hoisted(() => vi.fn());

vi.mock('@repo/crypto', () => ({
	unwrapWrk: mockUnwrapWrk,
	deriveKeys: mockDeriveKeys,
	decrypt: mockDecrypt,
	maskEntities: mockMaskEntities,
}));

vi.mock('@repo/db', () => ({
	createCommitment: mockCreateCommitment,
	createMemory: mockCreateMemory,
	upsertSummary: mockUpsertSummary,
	hasUserAiAnalysisConsent: mockHasUserAiAnalysisConsent,
	isDuplicateGoal: mockIsDuplicateGoal,
	createGoalProposal: mockCreateGoalProposal,
}));

vi.mock('../../ai/goal-extraction', () => ({
	extractGoals: mockExtractGoals,
}));

vi.mock('../../ai/prefilter', () => ({
	prefilterEntities: mockPrefilterEntities,
}));

vi.mock('../../lib/track', () => ({
	trackWorkerEvent: mockTrackAnalyticsEvent,
}));

// Mock all other AI modules that ai-flow.ts imports
vi.mock('../../ai/commitment-extraction', () => ({
	extractCommitmentsWithBandit: vi.fn(),
}));
vi.mock('../../ai/confidence-thresholds', () => ({
	getConfidenceThresholds: vi.fn(() => ({ extraction: 0.4, storage: 0.5 })),
}));
vi.mock('../../ai/contact-summary', () => ({
	generateContactSummary: vi.fn(),
}));
vi.mock('../../ai/dedup', () => ({
	deduplicateCommitment: vi.fn(),
}));
vi.mock('../../ai/embeddings', () => ({
	generateEmbedding: vi.fn(),
}));
vi.mock('../../ai/feedback-signals', () => ({
	recordExtractionFeedback: vi.fn(),
}));

// Mock BullMQ — capture processors
type MockProcessor = (job: unknown) => Promise<unknown> | unknown;
const workerProcessors: Record<string, MockProcessor> = {};
vi.mock('bullmq', () => ({
	FlowProducer: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
	Worker: vi.fn().mockImplementation((name: string, processor: MockProcessor) => {
		workerProcessors[name] = processor;
		return { on: vi.fn() };
	}),
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────────

const FAKE_WRK = Buffer.from('fake-wrk-32-bytes-long-enough!!');
const FAKE_DEK = Buffer.from('fake-dek-32-bytes-long-enough!!');
const FAKE_BIK = Buffer.from('fake-bik-for-masking-purposes!!');

function makeJobData(overrides?: Record<string, unknown>) {
	return {
		userId: 'user-001',
		contactId: 'contact-001',
		workspaceId: 'ws-001',
		keyEnvelope: {
			encryptedWrk: Buffer.from('encrypted-wrk').toString('base64'),
			kmsContext: { workspaceId: 'ws-001' },
			wrkVersion: 1,
		},
		messages: [
			{ role: 'user', content: 'encrypted-msg-1', timestamp: '2026-03-01T10:00:00Z' },
			{ role: 'contact', content: 'encrypted-msg-2', timestamp: '2026-03-01T10:01:00Z' },
		],
		workspaceSalt: FAKE_BIK.toString('hex'),
		...overrides,
	};
}

function makeJob(data: ReturnType<typeof makeJobData>) {
	return { data, id: 'job-001' };
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('GI4 — Goal Extraction Worker', () => {
	let goalExtractionProcessor: MockProcessor;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Default mock implementations
		mockUnwrapWrk.mockResolvedValue(FAKE_WRK);
		mockDeriveKeys.mockReturnValue({ dek: FAKE_DEK, bik: FAKE_BIK });
		mockDecrypt.mockImplementation((content: string) => `decrypted:${content}`);
		mockPrefilterEntities.mockReturnValue([]);
		mockMaskEntities.mockReturnValue({ maskedText: 'masked-title', entityMap: {} });
		mockIsDuplicateGoal.mockResolvedValue(false);
		mockCreateGoalProposal.mockResolvedValue({ id: 'goal-001' });
		mockHasUserAiAnalysisConsent.mockResolvedValue(true);

		// Import to trigger Worker registration
		await import('../ai-flow');
		goalExtractionProcessor = workerProcessors['goal-extraction'];
	});

	it('processor is registered for goal-extraction queue', () => {
		expect(goalExtractionProcessor).toBeDefined();
		expect(typeof goalExtractionProcessor).toBe('function');
	});

	it('skips when no messages', async () => {
		const job = makeJob(makeJobData({ messages: [] }));
		const result = await goalExtractionProcessor(job);
		expect(result).toBeUndefined();
		expect(mockExtractGoals).not.toHaveBeenCalled();
	});

	it('skips when no key envelope', async () => {
		const job = makeJob(makeJobData({ keyEnvelope: undefined }));
		const result = await goalExtractionProcessor(job);
		expect(result).toBeUndefined();
		expect(mockExtractGoals).not.toHaveBeenCalled();
	});

	it('decrypts messages before extraction (SEC-006)', async () => {
		mockExtractGoals.mockResolvedValue({ goals: [] });

		const job = makeJob(makeJobData());
		await goalExtractionProcessor(job);

		expect(mockUnwrapWrk).toHaveBeenCalledTimes(1);
		expect(mockDeriveKeys).toHaveBeenCalledWith(FAKE_WRK, 'ws-001', 1);
		expect(mockDecrypt).toHaveBeenCalledTimes(2);
		expect(mockDecrypt).toHaveBeenCalledWith('encrypted-msg-1', FAKE_DEK);
		expect(mockDecrypt).toHaveBeenCalledWith('encrypted-msg-2', FAKE_DEK);
	});

	it('passes decrypted messages to extractGoals', async () => {
		mockExtractGoals.mockResolvedValue({ goals: [] });

		const job = makeJob(makeJobData());
		await goalExtractionProcessor(job);

		expect(mockExtractGoals).toHaveBeenCalledTimes(1);
		const [messages, , workspaceSalt] = mockExtractGoals.mock.calls[0];
		expect(messages).toHaveLength(2);
		expect(messages[0].content).toBe('decrypted:encrypted-msg-1');
		expect(messages[1].content).toBe('decrypted:encrypted-msg-2');
		expect(workspaceSalt).toBe(FAKE_BIK);
	});

	it('returns stored=0 when no goals extracted', async () => {
		mockExtractGoals.mockResolvedValue({ goals: [] });

		const job = makeJob(makeJobData());
		const result = await goalExtractionProcessor(job);
		expect(result).toEqual({ stored: 0 });
	});

	it('filters goals with confidence < 0.4', async () => {
		mockExtractGoals.mockResolvedValue({
			goals: [{ title: 'Low confidence goal', type: 'business', confidence: 0.3, quote: 'test' }],
		});

		const job = makeJob(makeJobData());
		const result = await goalExtractionProcessor(job);

		expect(result).toEqual({ stored: 0 });
		expect(mockIsDuplicateGoal).not.toHaveBeenCalled();
		expect(mockCreateGoalProposal).not.toHaveBeenCalled();
	});

	it('skips duplicate goals via blind index', async () => {
		mockExtractGoals.mockResolvedValue({
			goals: [{ title: 'Close 5 DeFi deals', type: 'business', confidence: 0.85, quote: 'test' }],
		});
		mockIsDuplicateGoal.mockResolvedValue(true);

		const job = makeJob(makeJobData());
		const result = await goalExtractionProcessor(job);

		expect(result).toEqual({ stored: 0 });
		expect(mockIsDuplicateGoal).toHaveBeenCalledWith(
			'ws-001',
			'Close 5 DeFi deals',
			expect.any(Object),
		);
		expect(mockCreateGoalProposal).not.toHaveBeenCalled();
	});

	it('applies ELM masking on extracted goal titles (SEC-122)', async () => {
		mockExtractGoals.mockResolvedValue({
			goals: [
				{ title: 'Meet Alice from DeFi Corp', type: 'network', confidence: 0.8, quote: 'test' },
			],
		});

		const job = makeJob(makeJobData());
		await goalExtractionProcessor(job);

		expect(mockPrefilterEntities).toHaveBeenCalledWith('Meet Alice from DeFi Corp');
		expect(mockMaskEntities).toHaveBeenCalledWith(
			'Meet Alice from DeFi Corp',
			Buffer.from(FAKE_BIK.toString('hex'), 'hex'),
			[],
		);
	});

	it('stores goal proposal with correct data', async () => {
		mockExtractGoals.mockResolvedValue({
			goals: [
				{
					title: 'Close 5 DeFi deals',
					type: 'business',
					confidence: 0.9,
					quote: 'I want to close 5 DeFi deals',
					target_date: '2026-06-30T00:00:00Z',
				},
			],
		});

		const job = makeJob(makeJobData());
		const result = await goalExtractionProcessor(job);

		expect(result).toEqual({ stored: 1 });
		expect(mockCreateGoalProposal).toHaveBeenCalledWith(
			'ws-001',
			{
				type: 'business',
				title: 'Close 5 DeFi deals',
				description: 'I want to close 5 DeFi deals',
				targetDate: new Date('2026-06-30T00:00:00Z'),
			},
			expect.any(Object),
		);
	});

	it('stores proposal without targetDate when not provided', async () => {
		mockExtractGoals.mockResolvedValue({
			goals: [{ title: 'Grow network', type: 'network', confidence: 0.7, quote: 'want to grow' }],
		});

		const job = makeJob(makeJobData());
		await goalExtractionProcessor(job);

		const [, input] = mockCreateGoalProposal.mock.calls[0];
		expect(input.targetDate).toBeUndefined();
	});

	it('processes multiple goals, filtering by confidence and dedup', async () => {
		mockExtractGoals.mockResolvedValue({
			goals: [
				{ title: 'Goal A', type: 'business', confidence: 0.9, quote: 'a' },
				{ title: 'Goal B', type: 'network', confidence: 0.2, quote: 'b' },
				{ title: 'Goal C', type: 'habit', confidence: 0.8, quote: 'c' },
			],
		});
		// Goal C is a duplicate
		mockIsDuplicateGoal
			.mockResolvedValueOnce(false) // Goal A — not duplicate
			.mockResolvedValueOnce(true); // Goal C — duplicate

		const job = makeJob(makeJobData());
		const result = await goalExtractionProcessor(job);

		// Goal A stored, Goal B filtered (confidence), Goal C filtered (dedup)
		expect(result).toEqual({ stored: 1 });
		expect(mockCreateGoalProposal).toHaveBeenCalledTimes(1);
		expect(mockCreateGoalProposal.mock.calls[0][1].title).toBe('Goal A');
	});

	it('tracks analytics events for extraction and proposal', async () => {
		mockExtractGoals.mockResolvedValue({
			goals: [{ title: 'Track this goal', type: 'strategic', confidence: 0.85, quote: 'test' }],
		});

		const job = makeJob(makeJobData());
		await goalExtractionProcessor(job);

		expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith(
			'ws-001',
			'user-001',
			'goal.extracted',
			expect.objectContaining({ count: 1 }),
		);
		expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith(
			'ws-001',
			'user-001',
			'goal.proposed',
			expect.objectContaining({ type: 'strategic', confidence: 0.85 }),
		);
	});

	it('skips ELM masking when no workspaceSalt', async () => {
		mockExtractGoals.mockResolvedValue({
			goals: [{ title: 'No salt goal', type: 'business', confidence: 0.8, quote: 'test' }],
		});

		const job = makeJob(makeJobData({ workspaceSalt: undefined }));
		await goalExtractionProcessor(job);

		// Should still store the proposal — ELM masking is for logging, not storage
		expect(mockMaskEntities).not.toHaveBeenCalled();
		expect(mockCreateGoalProposal).toHaveBeenCalledTimes(1);
	});
});
