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
	withWorkspaceRLS: vi.fn((_workspaceId: string, fn: () => unknown) => fn()),
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

const EPISODE_MESSAGES = [
	{ role: 'user', content: "I'll send the report tomorrow", timestamp: '2026-01-01T00:00:00Z' },
];

function getHaikuSystemPrompt(): string {
	const request = mockHaikuCreate.mock.calls.at(-1)?.[0] as { system?: string } | undefined;
	return request?.system ?? '';
}

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

		mockGetTopPatterns.mockResolvedValue([]);
		mockGetGoldenLibrary.mockResolvedValue([]);
		mockHaikuCreate.mockResolvedValue(HAIKU_CANDIDATE_RESPONSE);
		mockInferWithCache.mockResolvedValue({ content: [] });
	});

	it('fetches top 10 patterns for commitment_extraction domain', async () => {
		mockGetTopPatterns.mockResolvedValue([]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(EPISODE_MESSAGES, '2026-01-01T00:00:00Z');

		expect(mockGetTopPatterns).toHaveBeenCalledWith('commitment_extraction', 10);
	});

	it('injects fetched pattern rules into the Haiku prompt without calling Sonnet', async () => {
		mockGetTopPatterns.mockResolvedValue([
			{ patternText: 'Ignore "we should catch up" phrasing', confidenceScore: 0.85 },
			{ patternText: 'Web3 "ape in" is financial', confidenceScore: 0.72 },
		]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(EPISODE_MESSAGES, '2026-01-01T00:00:00Z');

		expect(mockGetTopPatterns).toHaveBeenCalledWith('commitment_extraction', 10);
		const systemPrompt = getHaikuSystemPrompt();
		expect(systemPrompt).toContain('Learned calibration hints');
		expect(systemPrompt).toContain('Learned pattern rules');
		expect(systemPrompt).toContain('we should catch up');
		expect(systemPrompt).toContain('ape in');
		// inferWithCache is NOT called — Sonnet verification pass removed (P7)
		expect(mockInferWithCache).not.toHaveBeenCalled();
	});

	it('uses commitment_extraction as golden library domain (not seed_)', async () => {
		mockGetTopPatterns.mockResolvedValue([]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(EPISODE_MESSAGES, '2026-01-01T00:00:00Z');

		expect(mockGetGoldenLibrary).toHaveBeenCalledWith('commitment_extraction', 50, undefined);
	});

	it('injects only structural golden examples and omits raw example context', async () => {
		mockGetGoldenLibrary.mockResolvedValue([
			{
				inputContext: 'Alice alice@example.com said she would send the deck',
				correctedOutput: {
					title: 'Send deck to Alice alice@example.com',
					commitment_type: 'task',
					assignee: 'user',
					confidence: 0.76,
					quote: 'send the deck to Alice',
				},
				correctionReasoning: 'Alice asked for the deck by email',
			},
		]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(EPISODE_MESSAGES, '2026-01-01T00:00:00Z');

		const systemPrompt = getHaikuSystemPrompt();
		expect(systemPrompt).toContain('Verified structural examples');
		expect(systemPrompt).toContain('"commitment_type":"task"');
		expect(systemPrompt).toContain('"assignee":"user"');
		expect(systemPrompt).toContain('"confidence_bucket":"medium"');
		expect(systemPrompt).not.toContain('alice@example.com');
		expect(systemPrompt).not.toContain('Send deck to Alice');
		expect(systemPrompt).not.toContain('Input:');
		expect(systemPrompt).not.toContain('Reasoning:');
	});

	it('supports seeded golden examples that use commitments arrays and type fields', async () => {
		mockGetGoldenLibrary.mockResolvedValue([
			{
				inputContext: 'Marcus said he will wire funds and the user should prep docs',
				correctedOutput: {
					commitments: [
						{
							title: 'Wire $2M for Aptos SAFT',
							type: 'financial',
							assignee: 'contact',
							confidence: 0.92,
						},
						{
							title: 'Prepare execution version of SAFT',
							type: 'task',
							assignee: 'user',
							confidence: 0.95,
						},
					],
				},
			},
		]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(EPISODE_MESSAGES, '2026-01-01T00:00:00Z');

		const systemPrompt = getHaikuSystemPrompt();
		expect(systemPrompt).toContain('"commitment_count":2');
		expect(systemPrompt).toContain('"commitment_type":"financial"');
		expect(systemPrompt).toContain('"commitment_type":"task"');
		expect(systemPrompt).toContain('"assignee":"contact"');
		expect(systemPrompt).toContain('"assignee":"user"');
		expect(systemPrompt).not.toContain('Wire $2M');
		expect(systemPrompt).not.toContain('Prepare execution version');
	});

	it('redacts obvious PII from learned pattern rules before prompt injection', async () => {
		mockGetTopPatterns.mockResolvedValue([
			{
				patternText:
					'When jane@example.com posts https://example.com with @jane and 415-555-1212, treat it as informational.',
				confidenceScore: 0.9,
			},
		]);

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(EPISODE_MESSAGES, '2026-01-01T00:00:00Z');

		const systemPrompt = getHaikuSystemPrompt();
		expect(systemPrompt).toContain('[EMAIL]');
		expect(systemPrompt).toContain('[URL]');
		expect(systemPrompt).toContain('[HANDLE]');
		expect(systemPrompt).toContain('[PHONE]');
		expect(systemPrompt).not.toContain('jane@example.com');
		expect(systemPrompt).not.toContain('https://example.com');
		expect(systemPrompt).not.toContain('@jane');
		expect(systemPrompt).not.toContain('415-555-1212');
	});

	it('returns candidates alongside commitments in result', async () => {
		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(EPISODE_MESSAGES, '2026-01-01T00:00:00Z');

		expect(result).toHaveProperty('candidates');
		expect(result).toHaveProperty('commitments');
		expect(result).toHaveProperty('traceId');
		expect(result).toHaveProperty('variant');
		expect(Array.isArray(result.candidates)).toBe(true);
		expect(result.candidates.length).toBeGreaterThan(0);
	});

	it('filters candidates below 0.4 confidence threshold', async () => {
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
		const result = await extractCommitmentsWithBandit(EPISODE_MESSAGES, '2026-01-01T00:00:00Z');

		// All candidates returned
		expect(result.candidates).toHaveLength(2);
		// Only >= 0.4 confidence pass through
		expect(result.commitments).toHaveLength(1);
		expect(result.commitments[0].title).toBe('High confidence');
	});
});
