import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CGC: Morning Brief Decision Intelligence Tests
 *
 * Tests the three CGC additions to buildUserContext:
 * 1. Decision Provenance — most-cited rationales (last 30 days)
 * 2. Decision Success Rates — positive outcome rates by decision type
 * 3. Contradiction Warnings — contradicting knowledge nodes (last 7 days)
 */

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockDbExecute = vi.hoisted(() => vi.fn());

const mockGetActiveCommitments = vi.hoisted(() => vi.fn());
const mockGetOutcomeStats = vi.hoisted(() => vi.fn());
const mockGetPendingRecommendations = vi.hoisted(() => vi.fn());
const mockGetPreferences = vi.hoisted(() => vi.fn());
const mockHybridSearch = vi.hoisted(() => vi.fn());
const mockSaveBrief = vi.hoisted(() => vi.fn());
const mockListConnections = vi.hoisted(() => vi.fn());

const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockInferWithCache = vi.hoisted(() => vi.fn());
const mockBuildCalibrationKernelModifier = vi.hoisted(() => vi.fn());
const mockSelectPromptVariant = vi.hoisted(() => vi.fn());
const mockFindRelevantPrecedents = vi.hoisted(() => vi.fn());
const mockFormatPrecedents = vi.hoisted(() => vi.fn());
const mockScheduleRecommendations = vi.hoisted(() => vi.fn());
const mockBroadcastUpdate = vi.hoisted(() => vi.fn());

const processorStore = vi.hoisted(() => ({
	fn: null as ((job: unknown) => Promise<unknown>) | null,
}));

const mockSelectChain = vi.hoisted(() => ({
	from: vi.fn().mockReturnThis(),
	where: vi.fn().mockResolvedValue([]),
}));

vi.mock('@repo/db', () => ({
	db: {
		execute: mockDbExecute,
		select: vi.fn(() => mockSelectChain),
	},
	sql: vi.fn((...args: unknown[]) => args),
	eq: vi.fn((field, value) => ({ field, value })),
	inArray: vi.fn((field, values) => ({ field, values })),
	knowledgeNodes: {
		id: 'id',
		displayName: 'display_name',
	},
	workspaces: {
		id: 'id',
		encryptedWrk: 'encrypted_wrk',
		kmsContext: 'kms_context',
		wrkVersion: 'wrk_version',
	},
	getActiveCommitments: mockGetActiveCommitments,
	getOutcomeStats: mockGetOutcomeStats,
	getPendingRecommendations: mockGetPendingRecommendations,
	getPreferences: mockGetPreferences,
	hybridSearch: mockHybridSearch,
	saveBrief: mockSaveBrief,
	listConnections: mockListConnections,
	listDeals: vi.fn(() => Promise.resolve([])),
	getStageVelocityStats: vi.fn(() => Promise.resolve({ avgDaysPerStage: {}, conversionRates: {} })),
	listGoals: vi.fn(() => Promise.resolve([])),
	contacts: { id: 'id', workspaceId: 'workspace_id', lastMessageAt: 'last_message_at' },
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('bullmq', () => ({
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Worker: vi.fn(function (_name: string, processor: unknown) {
		if (_name === 'briefs') processorStore.fn = processor as (job: unknown) => Promise<unknown>;
		return { on: vi.fn() };
	}),
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Queue: vi.fn(function () {
		return { add: vi.fn(() => Promise.resolve()), on: vi.fn() };
	}),
}));

vi.mock('../embeddings', () => ({ generateEmbedding: mockGenerateEmbedding }));
vi.mock('../cached-inference', () => ({ inferWithCache: mockInferWithCache }));
vi.mock('../calibration-context', () => ({
	buildCalibrationKernelModifier: mockBuildCalibrationKernelModifier,
}));
vi.mock('../bandit', () => ({ selectPromptVariant: mockSelectPromptVariant }));
vi.mock('../precedents', () => ({
	findRelevantPrecedents: mockFindRelevantPrecedents,
	formatPrecedents: mockFormatPrecedents,
}));
vi.mock('../../queues/recommendations', () => ({
	scheduleRecommendations: mockScheduleRecommendations,
}));
vi.mock('../../realtime/broadcast', () => ({ broadcastUpdate: mockBroadcastUpdate }));
vi.mock('../../redis', () => ({ connection: {} }));

const { generateBriefWithBandit } = await import('../morning-brief');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const USER_ID = 'usr-00000000-0000-0000-0000-000000000001';

const fakeEnvelope = {
	encryptedWrk: Buffer.from('test-wrk'),
	kmsContext: { WorkspaceID: WS },
	wrkVersion: 1,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('morning brief decision intelligence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Base mocks for buildUserContext to reach decision sections
		mockGetActiveCommitments.mockResolvedValue([]);
		mockGetOutcomeStats.mockResolvedValue([]);
		mockGetPendingRecommendations.mockResolvedValue([]);
		mockHybridSearch.mockResolvedValue([]);
		mockListConnections.mockResolvedValue([]);
		mockFindRelevantPrecedents.mockResolvedValue([]);
		mockGenerateEmbedding.mockResolvedValue([]);
		mockInferWithCache.mockResolvedValue({
			content: [{ type: 'text', text: 'Morning brief text' }],
		});
		mockBuildCalibrationKernelModifier.mockResolvedValue('');
		mockSelectPromptVariant.mockResolvedValue({ variant: 'default', traceId: 'trace-1' });
		mockDbExecute.mockResolvedValue([]);
	});

	describe('decision success rates', () => {
		it('includes decision success rates when stats are available', async () => {
			// Provenance insights query returns empty
			mockDbExecute.mockResolvedValueOnce([]);
			// Decision success rates query returns stats
			mockDbExecute.mockResolvedValueOnce([
				{ decision_type: 'commitment', positive: '8', total: '10' },
				{ decision_type: 'purchase', positive: '3', total: '5' },
			]);
			// Contradiction query returns empty
			mockDbExecute.mockResolvedValueOnce([]);

			await generateBriefWithBandit(USER_ID, WS, fakeEnvelope);

			// The userContext passed to inferWithCache should contain success rates
			const inferCall = mockInferWithCache.mock.calls[0];
			const prompt = JSON.stringify(inferCall);
			expect(prompt).toContain('Decision Success Rates');
			expect(prompt).toContain('80%');
			expect(prompt).toContain('commitment');
		});

		it('omits decision success rates when no stats available', async () => {
			mockDbExecute.mockResolvedValue([]);

			await generateBriefWithBandit(USER_ID, WS, fakeEnvelope);

			const inferCall = mockInferWithCache.mock.calls[0];
			const prompt = JSON.stringify(inferCall);
			expect(prompt).not.toContain('Decision Success Rates');
		});

		it('handles decision stats query failure gracefully', async () => {
			// Provenance query succeeds
			mockDbExecute.mockResolvedValueOnce([]);
			// Decision stats query fails
			mockDbExecute.mockRejectedValueOnce(new Error('DB error'));
			// Contradiction query succeeds
			mockDbExecute.mockResolvedValueOnce([]);

			// Should not throw
			const result = await generateBriefWithBandit(USER_ID, WS, fakeEnvelope);
			expect(result.text).toBeDefined();
		});
	});

	describe('contradiction warnings', () => {
		it('includes contradiction alerts when found (last 7 days, limit 3)', async () => {
			// Provenance Step 1
			mockDbExecute.mockResolvedValueOnce([]);
			// Decision stats query
			mockDbExecute.mockResolvedValueOnce([]);
			// Contradiction Step 1: returns IDs only
			mockDbExecute.mockResolvedValueOnce([{ source_node_id: 'node-a', target_node_id: 'node-b' }]);
			// Contradiction Step 2: Drizzle ORM returns decrypted displayName
			mockSelectChain.where.mockResolvedValueOnce([
				{ id: 'node-a', displayName: 'Aggressive growth strategy' },
				{ id: 'node-b', displayName: 'Conservative approach' },
			]);

			await generateBriefWithBandit(USER_ID, WS, fakeEnvelope);

			const inferCall = mockInferWithCache.mock.calls[0];
			const prompt = JSON.stringify(inferCall);
			expect(prompt).toContain('Contradiction Alerts');
			expect(prompt).toContain('Aggressive growth strategy');
			expect(prompt).toContain('Conservative approach');
		});

		it('omits contradiction section when none found', async () => {
			mockDbExecute.mockResolvedValue([]);

			await generateBriefWithBandit(USER_ID, WS, fakeEnvelope);

			const inferCall = mockInferWithCache.mock.calls[0];
			const prompt = JSON.stringify(inferCall);
			expect(prompt).not.toContain('Contradiction Alerts');
		});

		it('handles contradiction query failure gracefully', async () => {
			mockDbExecute.mockResolvedValueOnce([]);
			mockDbExecute.mockResolvedValueOnce([]);
			mockDbExecute.mockRejectedValueOnce(new Error('DB error'));

			const result = await generateBriefWithBandit(USER_ID, WS, fakeEnvelope);
			expect(result.text).toBeDefined();
		});
	});

	describe('provenance insights', () => {
		it('includes most-cited rationales from last 30 days', async () => {
			// Step 1: raw SQL returns IDs + counts only
			mockDbExecute.mockResolvedValueOnce([
				{ id: 'node-1', citation_count: '7' },
				{ id: 'node-2', citation_count: '4' },
			]);
			// Decision stats query
			mockDbExecute.mockResolvedValueOnce([]);
			// Contradiction Step 1
			mockDbExecute.mockResolvedValueOnce([]);
			// Step 2: Drizzle ORM returns decrypted displayName
			mockSelectChain.where.mockResolvedValueOnce([
				{ id: 'node-1', displayName: 'Focus on high-value contacts' },
				{ id: 'node-2', displayName: 'Weekly follow-up cadence' },
			]);

			await generateBriefWithBandit(USER_ID, WS, fakeEnvelope);

			const inferCall = mockInferWithCache.mock.calls[0];
			const prompt = JSON.stringify(inferCall);
			expect(prompt).toContain('Decision Patterns');
			expect(prompt).toContain('Focus on high-value contacts');
			expect(prompt).toContain('7x');
		});
	});
});
