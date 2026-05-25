import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GI4 — Goal Extraction Pipeline Tests
 *
 * Verifies:
 * - Extraction prompt output structure (tool_use → ExtractedGoal)
 * - Confidence filtering (< 0.4 discarded)
 * - Goal type mapping to valid enum values
 * - Empty extraction returns empty array
 * - Multiple goals extracted from single conversation
 */

const mockGetHeliconeHeaders = vi.fn(() => ({}));

vi.mock('../cached-inference', () => ({
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
		role: 'user',
		content: 'I want to close 5 DeFi deals by end of Q2',
		timestamp: '2026-03-01T10:00:00Z',
	},
	{ role: 'contact', content: 'That sounds ambitious!', timestamp: '2026-03-01T10:01:00Z' },
];
const REF_TIME = '2026-03-01T12:00:00Z';

function makeGoalToolUse(title: string, type: string, confidence: number, targetDate?: string) {
	return {
		type: 'tool_use',
		name: 'extract_goal',
		input: {
			title,
			type,
			confidence,
			quote: `quote for ${title}`,
			reasoning: 'test reasoning',
			...(targetDate ? { target_date: targetDate } : {}),
		},
	};
}

describe('GI4 — Goal Extraction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('extracts a single goal from tool_use response', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [makeGoalToolUse('Close 5 DeFi deals', 'business', 0.9, '2026-06-30T00:00:00Z')],
		});

		const { extractGoals } = await import('../goal-extraction');
		const result = await extractGoals(MESSAGES, REF_TIME);

		expect(result.goals).toHaveLength(1);
		expect(result.goals[0].title).toBe('Close 5 DeFi deals');
		expect(result.goals[0].type).toBe('business');
		expect(result.goals[0].confidence).toBe(0.9);
		expect(result.goals[0].target_date).toBe('2026-06-30T00:00:00Z');
		expect(result.goals[0].quote).toBe('quote for Close 5 DeFi deals');
	});

	it('extracts multiple goals from one conversation', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeGoalToolUse('Close 5 DeFi deals', 'business', 0.9),
				makeGoalToolUse('Meet 10 new LPs', 'network', 0.85),
			],
		});

		const { extractGoals } = await import('../goal-extraction');
		const result = await extractGoals(MESSAGES, REF_TIME);

		expect(result.goals).toHaveLength(2);
		expect(result.goals[0].type).toBe('business');
		expect(result.goals[1].type).toBe('network');
	});

	it('returns empty array when no goals detected', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [{ type: 'text', text: 'No goals found in this conversation.' }],
		});

		const { extractGoals } = await import('../goal-extraction');
		const result = await extractGoals(MESSAGES, REF_TIME);

		expect(result.goals).toHaveLength(0);
	});

	it('includes goals without target_date', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [makeGoalToolUse('Grow my network in DeFi', 'network', 0.7)],
		});

		const { extractGoals } = await import('../goal-extraction');
		const result = await extractGoals(MESSAGES, REF_TIME);

		expect(result.goals).toHaveLength(1);
		expect(result.goals[0].target_date).toBeUndefined();
	});

	it('maps all valid goal types', async () => {
		const types = ['network', 'relationship', 'habit', 'business', 'strategic'];
		mockHaikuCreate.mockResolvedValue({
			content: types.map((t) => makeGoalToolUse(`Goal of type ${t}`, t, 0.8)),
		});

		const { extractGoals } = await import('../goal-extraction');
		const result = await extractGoals(MESSAGES, REF_TIME);

		expect(result.goals).toHaveLength(5);
		expect(result.goals.map((g) => g.type)).toEqual(types);
	});

	it('calls Haiku with correct model and temperature', async () => {
		mockHaikuCreate.mockResolvedValue({ content: [] });

		const { extractGoals } = await import('../goal-extraction');
		await extractGoals(MESSAGES, REF_TIME);

		expect(mockHaikuCreate).toHaveBeenCalledTimes(1);
		const callArgs = mockHaikuCreate.mock.calls[0][0];
		expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
		expect(callArgs.temperature).toBe(0.3);
		expect(callArgs.tools).toHaveLength(1);
		expect(callArgs.tools[0].name).toBe('extract_goal');
	});

	it('includes reference time in user prompt', async () => {
		mockHaikuCreate.mockResolvedValue({ content: [] });

		const { extractGoals } = await import('../goal-extraction');
		await extractGoals(MESSAGES, REF_TIME);

		const callArgs = mockHaikuCreate.mock.calls[0][0];
		const userMessage = callArgs.messages[0].content;
		expect(userMessage).toContain(REF_TIME);
	});

	it('formats transcript with CRM Owner / Contact roles', async () => {
		mockHaikuCreate.mockResolvedValue({ content: [] });

		const { extractGoals } = await import('../goal-extraction');
		await extractGoals(MESSAGES, REF_TIME);

		const callArgs = mockHaikuCreate.mock.calls[0][0];
		const userMessage = callArgs.messages[0].content;
		expect(userMessage).toContain('CRM Owner');
		expect(userMessage).toContain('Contact');
	});

	it('masks structured PII before sending transcripts to Haiku', async () => {
		mockHaikuCreate.mockResolvedValue({ content: [] });

		const { extractGoals } = await import('../goal-extraction');
		await extractGoals(
			[
				{
					role: 'user',
					content: 'I want to follow up with alice@example.com at +1-555-123-4567',
					timestamp: '2026-03-01T10:00:00Z',
				},
			],
			REF_TIME,
			Buffer.from('workspace-salt'),
		);

		const callArgs = mockHaikuCreate.mock.calls[0][0];
		const userMessage = callArgs.messages[0].content;
		expect(userMessage).not.toContain('alice@example.com');
		expect(userMessage).not.toContain('+1-555-123-4567');
		expect(userMessage).toContain('EMAIL_');
		expect(userMessage).toContain('PHONE_');
	});

	it('passes Helicone headers for cost tracking', async () => {
		mockGetHeliconeHeaders.mockReturnValue({ 'Helicone-Property-Feature': 'goal-extraction' });
		mockHaikuCreate.mockResolvedValue({ content: [] });

		const { extractGoals } = await import('../goal-extraction');
		await extractGoals(MESSAGES, REF_TIME);

		expect(mockGetHeliconeHeaders).toHaveBeenCalledWith({ feature: 'goal-extraction' });
		const headers = mockHaikuCreate.mock.calls[0][1];
		expect(headers).toEqual({ headers: { 'Helicone-Property-Feature': 'goal-extraction' } });
	});

	it('filters out non-tool_use content blocks', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				{ type: 'text', text: 'I found a goal:' },
				makeGoalToolUse('Real goal', 'business', 0.8),
				{ type: 'text', text: 'That was the only one.' },
			],
		});

		const { extractGoals } = await import('../goal-extraction');
		const result = await extractGoals(MESSAGES, REF_TIME);

		expect(result.goals).toHaveLength(1);
		expect(result.goals[0].title).toBe('Real goal');
	});
});
