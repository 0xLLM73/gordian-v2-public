import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P7 Cost Optimization — Sonnet removal + confidence routing tests.
 *
 * Verifies:
 * - Sonnet is never called (inferWithCache not invoked)
 * - Confidence >= 0.95 auto-confirmed (returned in commitments)
 * - Confidence 0.4-0.95 drafts (returned in commitments)
 * - Confidence < 0.4 discarded (only in candidates, not commitments)
 * - Exact boundary at 0.4 included
 */

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

const mockHaikuCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
	default: class MockAnthropic {
		messages = { create: mockHaikuCreate };
	},
}));

const MESSAGES = [
	{
		role: 'contact',
		content: 'Can you send the report tomorrow?',
		timestamp: '2026-01-01T00:00:00Z',
	},
];
const REF_TIME = '2026-01-01T00:00:00Z';

function makeCandidate(title: string, confidence: number) {
	return {
		type: 'tool_use',
		name: 'extract_commitment',
		input: {
			title,
			commitment_type: 'task',
			assignee: 'user',
			confidence,
			quote: `quote for ${title}`,
		},
	};
}

describe('P7 — Sonnet removal + confidence routing', () => {
	beforeAll(() => {
		vi.useFakeTimers();
	});

	afterAll(() => {
		vi.useRealTimers();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		// Advance past 5-min TTL cache
		vi.advanceTimersByTime(6 * 60 * 1000);
		mockGetTopPatterns.mockResolvedValue([]);
		mockGetGoldenLibrary.mockResolvedValue([]);
		mockInferWithCache.mockResolvedValue({ content: [] });
	});

	it('Sonnet (inferWithCache) is never called', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [makeCandidate('Send report', 0.8)],
		});

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(MESSAGES, REF_TIME);

		// inferWithCache was the Sonnet Pass 2 — should never be called
		expect(mockInferWithCache).not.toHaveBeenCalled();
		// Haiku Pass 1 should be called
		expect(mockHaikuCreate).toHaveBeenCalledTimes(1);
	});

	it('masks structured PII before sending transcripts to Haiku', async () => {
		mockHaikuCreate.mockResolvedValue({ content: [] });

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		await extractCommitmentsWithBandit(
			[
				{
					role: 'contact',
					content: 'Can you send alice@example.com the report tomorrow and call +1-555-123-4567?',
					timestamp: '2026-01-01T00:00:00Z',
				},
			],
			REF_TIME,
			'user-1',
			'workspace-1',
			{ workspaceSalt: Buffer.from('workspace-salt') },
		);

		const callArgs = mockHaikuCreate.mock.calls[0][0];
		const userMessage = callArgs.messages[0].content;
		expect(userMessage).not.toContain('alice@example.com');
		expect(userMessage).not.toContain('+1-555-123-4567');
		expect(userMessage).toContain('EMAIL_');
		expect(userMessage).toContain('PHONE_');
	});

	it('confidence >= 0.95 auto-confirmed (in commitments)', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [makeCandidate('Auto-confirm task', 0.95)],
		});

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(MESSAGES, REF_TIME);

		expect(result.commitments).toHaveLength(1);
		expect(result.commitments[0].title).toBe('Auto-confirm task');
		expect(result.commitments[0].confidence).toBe(0.95);
	});

	it('confidence 0.5 → draft (in commitments, above 0.4 threshold)', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [makeCandidate('Draft task', 0.5)],
		});

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(MESSAGES, REF_TIME);

		expect(result.commitments).toHaveLength(1);
		expect(result.commitments[0].title).toBe('Draft task');
		expect(result.commitments[0].confidence).toBe(0.5);
	});

	it('confidence 0.3 → discarded (not in commitments, only in candidates)', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [makeCandidate('Discarded task', 0.3)],
		});

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(MESSAGES, REF_TIME);

		// Present in candidates
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0].title).toBe('Discarded task');
		// Filtered from commitments
		expect(result.commitments).toHaveLength(0);
	});

	it('boundary: confidence exactly 0.4 is included', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [makeCandidate('Boundary task', 0.4)],
		});

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(MESSAGES, REF_TIME);

		expect(result.commitments).toHaveLength(1);
		expect(result.commitments[0].confidence).toBe(0.4);
	});

	it('boundary: confidence 0.39 is discarded', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [makeCandidate('Just below threshold', 0.39)],
		});

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(MESSAGES, REF_TIME);

		expect(result.commitments).toHaveLength(0);
		expect(result.candidates).toHaveLength(1);
	});

	it('routes all three confidence tiers correctly in one response', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeCandidate('High confidence', 0.95),
				makeCandidate('Medium confidence', 0.5),
				makeCandidate('Low confidence', 0.3),
			],
		});

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(MESSAGES, REF_TIME);

		// All 3 in candidates
		expect(result.candidates).toHaveLength(3);

		// Only 2 pass the 0.4 threshold (0.95 and 0.5)
		expect(result.commitments).toHaveLength(2);
		expect(result.commitments.map((c) => c.title)).toContain('High confidence');
		expect(result.commitments.map((c) => c.title)).toContain('Medium confidence');
		expect(result.commitments.map((c) => c.title)).not.toContain('Low confidence');

		// Sonnet never called
		expect(mockInferWithCache).not.toHaveBeenCalled();
	});

	it('candidates below 0.4 filtered from commitments array', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeCandidate('Keep', 0.9),
				makeCandidate('Keep2', 0.41),
				makeCandidate('Discard1', 0.39),
				makeCandidate('Discard2', 0.1),
			],
		});

		const { extractCommitmentsWithBandit } = await import('../commitment-extraction');
		const result = await extractCommitmentsWithBandit(MESSAGES, REF_TIME);

		expect(result.candidates).toHaveLength(4);
		expect(result.commitments).toHaveLength(2);
		expect(result.commitments.every((c) => c.confidence >= 0.4)).toBe(true);
	});
});
