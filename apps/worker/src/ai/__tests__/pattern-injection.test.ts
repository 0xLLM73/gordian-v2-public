import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetTopPatterns = vi.fn();
const mockGetGoldenLibrary = vi.fn();
const mockGetBanditStatsBucketed = vi.fn((): Promise<never[]> => Promise.resolve([]));
const mockRecordBanditTrial = vi.fn((): Promise<null> => Promise.resolve(null));
const mockFinalizeBanditReward = vi.fn((): Promise<null> => Promise.resolve(null));
const mockInferWithCache = vi.fn();
const mockGetHeliconeHeaders = vi.fn(() => ({}));

vi.mock('@repo/db', () => ({
	getTopPatterns: mockGetTopPatterns,
	getGoldenLibrary: mockGetGoldenLibrary,
	getBanditStatsBucketed: mockGetBanditStatsBucketed,
	recordBanditTrial: mockRecordBanditTrial,
	finalizeBanditReward: mockFinalizeBanditReward,
}));

vi.mock('../cached-inference', () => ({
	inferWithCache: mockInferWithCache,
	getHeliconeHeaders: mockGetHeliconeHeaders,
}));

// P8: Mock commitment heuristics (no match → falls through to Haiku)
vi.mock('../commitment-heuristics', () => ({
	checkCommitmentHeuristic: () => ({ matched: false, pattern: '', confidence: 0 }),
}));

// Mock Haiku client for Pass 1 extraction
const mockHaikuCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
	default: class MockAnthropic {
		messages = { create: mockHaikuCreate };
	},
}));

/** A single candidate from Haiku extraction */
const HAIKU_CANDIDATE_RESPONSE = {
	content: [
		{
			type: 'tool_use',
			name: 'extract_commitment',
			input: {
				title: 'Send report',
				commitment_type: 'task',
				assignee: 'user',
				confidence: 0.8,
				quote: "I'll send the report",
			},
		},
	],
};

describe('pattern injection into extraction prompts', () => {
	beforeAll(() => {
		vi.useFakeTimers();
	});

	afterAll(() => {
		vi.useRealTimers();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		// Advance past the 5-min TTL cache so each test gets fresh data
		vi.advanceTimersByTime(6 * 60 * 1000);

		mockGetGoldenLibrary.mockResolvedValue([]);
		mockHaikuCreate.mockResolvedValue(HAIKU_CANDIDATE_RESPONSE);
		mockInferWithCache.mockResolvedValue({ content: [] });
	});

	it('fetches top 10 patterns for commitment_extraction domain', async () => {
		mockGetTopPatterns.mockResolvedValue([]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(
			[{ role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' }],
			'2026-01-01T00:00:00Z',
		);

		expect(mockGetTopPatterns).toHaveBeenCalledWith('commitment_extraction', 10);
	});

	it('still fetches patterns even though Sonnet pass is removed (feedback loop)', async () => {
		mockGetTopPatterns.mockResolvedValue([
			{ patternText: 'Ignore "we should catch up" phrasing', confidenceScore: 0.85 },
			{ patternText: 'Web3 "ape in" is financial', confidenceScore: 0.72 },
		]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(
			[{ role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' }],
			'2026-01-01T00:00:00Z',
		);

		// Patterns are fetched (cache warmed for feedback loop) but Sonnet pass no longer invoked
		expect(mockGetTopPatterns).toHaveBeenCalledWith('commitment_extraction', 10);
		// inferWithCache is NOT called — Sonnet verification pass removed (P7)
		expect(mockInferWithCache).not.toHaveBeenCalled();
	});

	it('uses commitment_extraction as golden library domain (not seed_)', async () => {
		mockGetTopPatterns.mockResolvedValue([]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(
			[{ role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' }],
			'2026-01-01T00:00:00Z',
		);

		expect(mockGetGoldenLibrary).toHaveBeenCalledWith('commitment_extraction', 50, undefined);
	});

	it('returns candidates alongside commitments in result', async () => {
		mockGetTopPatterns.mockResolvedValue([]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(
			[{ role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' }],
			'2026-01-01T00:00:00Z',
		);

		expect(result).toHaveProperty('candidates');
		expect(result).toHaveProperty('commitments');
		expect(result).toHaveProperty('traceId');
		expect(result).toHaveProperty('variant');
		expect(Array.isArray(result.candidates)).toBe(true);
		expect(result.candidates.length).toBeGreaterThan(0);
	});

	it('filters candidates below 0.4 confidence threshold', async () => {
		mockGetTopPatterns.mockResolvedValue([]);
		mockHaikuCreate.mockResolvedValue({
			content: [
				{
					type: 'tool_use',
					name: 'extract_commitment',
					input: {
						title: 'High confidence',
						commitment_type: 'task',
						assignee: 'user',
						confidence: 0.9,
						quote: 'will do it',
					},
				},
				{
					type: 'tool_use',
					name: 'extract_commitment',
					input: {
						title: 'Low confidence',
						commitment_type: 'task',
						assignee: 'user',
						confidence: 0.3,
						quote: 'maybe sometime',
					},
				},
			],
		});

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(
			[{ role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00Z' }],
			'2026-01-01T00:00:00Z',
		);

		// All candidates returned
		expect(result.candidates).toHaveLength(2);
		// Only >= 0.4 confidence pass through
		expect(result.commitments).toHaveLength(1);
		expect(result.commitments[0].title).toBe('High confidence');
	});
});
