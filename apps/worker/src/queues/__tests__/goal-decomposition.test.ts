import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GI2 — Goal Decomposition Worker Tests
 *
 * Verifies:
 * - Worker processor registered on correct queue
 * - Skips when no envelope / goal not found / goal not active
 * - Skips replan when pace >= 0.75
 * - ELM masking on goal title before LLM
 * - KG search for context injection
 * - Actions stored via createGoalAction DAL
 * - Analytics events fired
 * - Replan skips when no pending actions
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetGoal = vi.fn();
const mockListGoalActions = vi.fn();
const mockListGoalProgressEvents = vi.fn();
const mockSearchKnowledgeNodes = vi.fn();
const mockListContactIdsByKnowledge = vi.fn();
const mockGetHealthScore = vi.fn();
const mockCreateGoalAction = vi.fn();

vi.mock('@repo/db', () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn(() => [
						{
							encryptedWrk: Buffer.from('mock-wrk').toString('base64'),
							kmsContext: '{"purpose":"test"}',
							wrkVersion: 1,
						},
					]),
				})),
			})),
		})),
	},
	eq: vi.fn(),
	workspaces: { id: 'id', encryptedWrk: 'ew', kmsContext: 'kc', wrkVersion: 'wv' },
	getGoal: mockGetGoal,
	listGoalActions: mockListGoalActions,
	listGoalProgressEvents: mockListGoalProgressEvents,
	searchKnowledgeNodes: mockSearchKnowledgeNodes,
	listContactIdsByKnowledge: mockListContactIdsByKnowledge,
	getHealthScore: mockGetHealthScore,
	createGoalAction: mockCreateGoalAction,
}));

const mockMaskEntities = vi.fn((_text: string, _salt: Buffer, _detected: unknown[]) => ({
	maskedText: 'MASKED_TITLE',
	entityMap: [],
}));
const mockPrefilterEntities = vi.fn((_text: string) => [] as unknown[]);

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	getCurrentKeys: vi.fn(() => ({ bik: Buffer.from('test-bik') })),
	keyStore: { getStore: vi.fn(() => ({ bik: Buffer.from('test-bik') })) },
	maskEntities: (...args: unknown[]) =>
		mockMaskEntities(args[0] as string, args[1] as Buffer, args[2] as unknown[]),
	prefilterEntities: (...args: unknown[]) => mockPrefilterEntities(args[0] as string),
}));

const mockGenerateEmbedding = vi.fn((_text: string) => Promise.resolve(new Array(512).fill(0.1)));
vi.mock('../../ai/embeddings', () => ({
	generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(args[0] as string),
}));

const mockDecomposeGoal = vi.fn();
vi.mock('../../ai/goal-decomposition', async (importOriginal) => {
	const original = await importOriginal<typeof import('../../ai/goal-decomposition')>();
	return {
		...original,
		decomposeGoal: (...args: unknown[]) => mockDecomposeGoal(args[0]),
	};
});

const mockTrackAnalyticsEvent = vi.fn();
vi.mock('../../lib/track', () => ({
	trackWorkerEvent: (...args: unknown[]) =>
		mockTrackAnalyticsEvent(args[0], args[1], args[2], args[3]),
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

type MockProcessor = (job: unknown) => Promise<unknown> | unknown;

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
	Worker: vi.fn().mockImplementation((_name: string, processor: MockProcessor) => {
		(Worker as unknown as Record<string, unknown>).__processor = processor;
		return { on: vi.fn() };
	}),
}));

import { Worker } from 'bullmq';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-test-1234';
const GOAL_ID = 'goal-test-5678';

function makeJob(overrides?: Partial<{ goalId: string; workspaceId: string; trigger: string }>) {
	return {
		data: {
			goalId: overrides?.goalId ?? GOAL_ID,
			workspaceId: overrides?.workspaceId ?? WORKSPACE_ID,
			trigger: overrides?.trigger ?? 'initial',
		},
	};
}

const MOCK_GOAL = {
	id: GOAL_ID,
	workspaceId: WORKSPACE_ID,
	title: 'Close 5 DeFi deals',
	type: 'business',
	status: 'active',
	currentCount: 1,
	targetCount: 5,
	targetDate: new Date(Date.now() + 30 * 86400000),
	createdAt: new Date(Date.now() - 10 * 86400000),
};

const MOCK_ACTIONS = {
	actions: [
		{
			title: 'Research protocols',
			description: 'Look into DeFi protocols',
			suggestedContactId: null,
			actionType: 'information_gathering' as const,
			domainTag: 'financial' as const,
			effort: 'medium' as const,
			matchReason: 'Relevant KG data',
		},
		{
			title: 'Contact LP partner',
			description: 'Reach out about deal',
			suggestedContactId: null,
			actionType: 'contact_outreach' as const,
			domainTag: 'networking' as const,
			effort: 'quick' as const,
			matchReason: 'High health score',
		},
		{
			title: 'Draft term sheet',
			description: 'Create initial terms',
			suggestedContactId: null,
			actionType: 'document_creation' as const,
			domainTag: 'legal' as const,
			effort: 'deep' as const,
			matchReason: 'Required for deal progression',
		},
	],
	reasoning: 'Prerequisite chain: research → outreach → documentation',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GI2 — Goal Decomposition Worker', () => {
	let processor: (job: ReturnType<typeof makeJob>) => Promise<unknown>;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Reset default mocks
		mockGetGoal.mockResolvedValue(MOCK_GOAL);
		mockListGoalActions.mockResolvedValue([]);
		mockListGoalProgressEvents.mockResolvedValue([]);
		mockSearchKnowledgeNodes.mockResolvedValue([]);
		mockListContactIdsByKnowledge.mockResolvedValue([]);
		mockGetHealthScore.mockResolvedValue(null);
		mockCreateGoalAction.mockResolvedValue({ id: 'action-1' });
		mockDecomposeGoal.mockResolvedValue(MOCK_ACTIONS);

		// Import module to register the worker
		await import('../goal-decomposition');
		processor = (Worker as unknown as Record<string, unknown>).__processor as typeof processor;
	});

	it('registers worker on goal-decomposition queue', () => {
		expect(Worker).toHaveBeenCalledWith(
			'goal-decomposition',
			expect.any(Function),
			expect.objectContaining({ prefix: '{ai-flow}', concurrency: 2 }),
		);
	});

	it('skips when goal not found', async () => {
		mockGetGoal.mockResolvedValue(null);

		await processor(makeJob());

		expect(mockDecomposeGoal).not.toHaveBeenCalled();
		expect(mockCreateGoalAction).not.toHaveBeenCalled();
	});

	it('skips when goal is not active', async () => {
		mockGetGoal.mockResolvedValue({ ...MOCK_GOAL, status: 'completed' });

		await processor(makeJob());

		expect(mockDecomposeGoal).not.toHaveBeenCalled();
	});

	it('calls ELM masking on goal title before LLM', async () => {
		await processor(makeJob());

		expect(mockPrefilterEntities).toHaveBeenCalledWith('Close 5 DeFi deals');
		expect(mockMaskEntities).toHaveBeenCalled();
		expect(mockGenerateEmbedding).toHaveBeenCalledWith('MASKED_TITLE');
	});

	it('searches knowledge graph for context', async () => {
		await processor(makeJob());

		expect(mockSearchKnowledgeNodes).toHaveBeenCalledWith(
			WORKSPACE_ID,
			'',
			expect.any(Array),
			expect.anything(),
		);
	});

	it('stores actions via createGoalAction DAL', async () => {
		await processor(makeJob());

		expect(mockCreateGoalAction).toHaveBeenCalledTimes(3);
		expect(mockCreateGoalAction).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({
				goalId: GOAL_ID,
				title: 'Research protocols',
				actionType: 'information_gathering',
				domainTag: 'financial',
				effort: 'medium',
			}),
			expect.anything(), // envelope
		);
	});

	it('fires analytics event on successful decomposition', async () => {
		await processor(makeJob());

		expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith(
			WORKSPACE_ID,
			'',
			'goal.decomposed',
			expect.objectContaining({
				goal_id: GOAL_ID,
				trigger: 'initial',
				action_count: 3,
			}),
		);
	});

	it('returns stored count', async () => {
		const result = await processor(makeJob());

		expect(result).toEqual({
			stored: 3,
			reasoning: 'Prerequisite chain: research → outreach → documentation',
		});
	});

	it('handles LLM returning no actions', async () => {
		mockDecomposeGoal.mockResolvedValue({ actions: [], reasoning: 'Cannot decompose' });

		const result = await processor(makeJob());

		expect(result).toEqual({ stored: 0 });
		expect(mockCreateGoalAction).not.toHaveBeenCalled();
	});

	it('skips replan when no pending actions exist', async () => {
		mockListGoalActions.mockResolvedValue([
			{ id: 'a1', status: 'completed' },
			{ id: 'a2', status: 'completed' },
		]);

		await processor(makeJob({ trigger: 'replan' }));

		expect(mockDecomposeGoal).not.toHaveBeenCalled();
	});

	it('skips replan when pace is adequate', async () => {
		// Goal with good pace (ahead of schedule)
		mockGetGoal.mockResolvedValue({
			...MOCK_GOAL,
			currentCount: 4,
			targetCount: 5,
		});
		mockListGoalActions.mockResolvedValue([{ id: 'a1', status: 'pending' }]);

		await processor(makeJob({ trigger: 'replan' }));

		expect(mockDecomposeGoal).not.toHaveBeenCalled();
	});

	it('proceeds with replan when pace < 0.75 and pending actions exist', async () => {
		// Goal that's behind pace
		mockGetGoal.mockResolvedValue({
			...MOCK_GOAL,
			currentCount: 0,
			targetCount: 10,
			targetDate: new Date(Date.now() + 5 * 86400000),
			createdAt: new Date(Date.now() - 15 * 86400000),
		});
		mockListGoalActions.mockResolvedValue([{ id: 'a1', status: 'pending' }]);

		await processor(makeJob({ trigger: 'replan' }));

		expect(mockDecomposeGoal).toHaveBeenCalled();
	});
});
