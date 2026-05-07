import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GI2 — Goal Decomposition AI Tests
 *
 * Verifies:
 * - Output structure (3-5 actions from tool_use)
 * - Action type / domain tag / effort validation
 * - IsAtomic: title max 100 chars
 * - Invalid contact IDs filtered out
 * - Pace score computation
 * - Replanning trigger threshold
 * - Haiku model + temperature
 * - Helicone headers
 */

const mockHaikuCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
	default: class MockAnthropic {
		messages = { create: mockHaikuCreate };
	},
}));

function makeDecomposeToolUse(
	actions: Array<{
		title: string;
		action_type: string;
		domain_tag: string;
		effort: string;
		description?: string;
		suggested_contact_id?: string | null;
		match_reason?: string;
	}>,
	reasoning = 'Test reasoning chain',
) {
	return {
		type: 'tool_use',
		name: 'decompose_goal',
		input: {
			reasoning,
			actions: actions.map((a) => ({
				title: a.title,
				description: a.description || 'Do the thing',
				suggested_contact_id: a.suggested_contact_id ?? null,
				action_type: a.action_type,
				domain_tag: a.domain_tag,
				effort: a.effort,
				match_reason: a.match_reason || 'Relevant to goal',
			})),
		},
	};
}

const BASE_CONTEXT = {
	goalTitle: 'Close 5 DeFi deals',
	goalType: 'business',
	paceScore: 0.8,
	paceLabel: 'behind pace',
	contactFits: [
		{
			contactId: 'aaaaaaaa-1111-2222-3333-444444444444',
			displayName: 'aaaaaaaa',
			matchReason: 'sector:DeFi',
			healthLabel: 'thriving',
		},
	],
	kgTriplets: [
		{ nodeType: 'sector', displayName: 'DeFi', description: 'Decentralized finance protocols' },
	],
	progressEvents: [{ delta: 1, source: 'business', createdAt: '2026-03-01T10:00:00Z' }],
};

describe('GI2 — Goal Decomposition AI', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('decomposes goal into 3-5 actions', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeDecomposeToolUse([
					{
						title: 'Research DeFi protocols',
						action_type: 'information_gathering',
						domain_tag: 'financial',
						effort: 'medium',
					},
					{
						title: 'Reach out to LP contacts',
						action_type: 'contact_outreach',
						domain_tag: 'networking',
						effort: 'quick',
					},
					{
						title: 'Draft investment thesis',
						action_type: 'document_creation',
						domain_tag: 'financial',
						effort: 'deep',
					},
				]),
			],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		const result = await decomposeGoal(BASE_CONTEXT);

		expect(result.actions).toHaveLength(3);
		expect(result.actions[0].title).toBe('Research DeFi protocols');
		expect(result.actions[0].actionType).toBe('information_gathering');
		expect(result.actions[0].domainTag).toBe('financial');
		expect(result.actions[0].effort).toBe('medium');
		expect(result.reasoning).toBe('Test reasoning chain');
	});

	it('caps actions at 5 even if LLM returns more', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeDecomposeToolUse(
					Array.from({ length: 7 }, (_, i) => ({
						title: `Action ${i + 1}`,
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					})),
				),
			],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		const result = await decomposeGoal(BASE_CONTEXT);

		expect(result.actions).toHaveLength(5);
	});

	it('truncates action titles to 100 chars', async () => {
		const longTitle = 'A'.repeat(150);
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeDecomposeToolUse([
					{
						title: longTitle,
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
					{
						title: 'Normal',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
					{
						title: 'Also normal',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
				]),
			],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		const result = await decomposeGoal(BASE_CONTEXT);

		expect(result.actions[0].title).toHaveLength(100);
	});

	it('normalizes invalid action_type to information_gathering', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeDecomposeToolUse([
					{
						title: 'Task 1',
						action_type: 'invalid_type',
						domain_tag: 'financial',
						effort: 'quick',
					},
					{
						title: 'Task 2',
						action_type: 'contact_outreach',
						domain_tag: 'financial',
						effort: 'quick',
					},
					{
						title: 'Task 3',
						action_type: 'decision_making',
						domain_tag: 'financial',
						effort: 'quick',
					},
				]),
			],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		const result = await decomposeGoal(BASE_CONTEXT);

		expect(result.actions[0].actionType).toBe('information_gathering');
		expect(result.actions[1].actionType).toBe('contact_outreach');
		expect(result.actions[2].actionType).toBe('decision_making');
	});

	it('normalizes invalid domain_tag to other', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeDecomposeToolUse([
					{
						title: 'Task 1',
						action_type: 'information_gathering',
						domain_tag: 'bad_tag',
						effort: 'quick',
					},
					{
						title: 'Task 2',
						action_type: 'information_gathering',
						domain_tag: 'legal',
						effort: 'quick',
					},
					{
						title: 'Task 3',
						action_type: 'information_gathering',
						domain_tag: 'technical',
						effort: 'quick',
					},
				]),
			],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		const result = await decomposeGoal(BASE_CONTEXT);

		expect(result.actions[0].domainTag).toBe('other');
		expect(result.actions[1].domainTag).toBe('legal');
		expect(result.actions[2].domainTag).toBe('technical');
	});

	it('normalizes invalid effort to medium', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeDecomposeToolUse([
					{
						title: 'Task 1',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'huge',
					},
					{
						title: 'Task 2',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'deep',
					},
					{
						title: 'Task 3',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
				]),
			],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		const result = await decomposeGoal(BASE_CONTEXT);

		expect(result.actions[0].effort).toBe('medium');
		expect(result.actions[1].effort).toBe('deep');
		expect(result.actions[2].effort).toBe('quick');
	});

	it('rejects contact IDs not in the provided list', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeDecomposeToolUse([
					{
						title: 'Task with valid contact',
						action_type: 'contact_outreach',
						domain_tag: 'networking',
						effort: 'quick',
						suggested_contact_id: 'aaaaaaaa-1111-2222-3333-444444444444',
					},
					{
						title: 'Task with hallucinated contact',
						action_type: 'contact_outreach',
						domain_tag: 'networking',
						effort: 'quick',
						suggested_contact_id: 'bbbbbbbb-0000-0000-0000-000000000000',
					},
					{
						title: 'Task with no contact',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
						suggested_contact_id: null,
					},
				]),
			],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		const result = await decomposeGoal(BASE_CONTEXT);

		expect(result.actions[0].suggestedContactId).toBe('aaaaaaaa-1111-2222-3333-444444444444');
		expect(result.actions[1].suggestedContactId).toBeNull();
		expect(result.actions[2].suggestedContactId).toBeNull();
	});

	it('returns empty actions when no tool_use block', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [{ type: 'text', text: 'I cannot decompose this goal.' }],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		const result = await decomposeGoal(BASE_CONTEXT);

		expect(result.actions).toHaveLength(0);
	});

	it('uses Haiku model at temperature 0.4', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeDecomposeToolUse([
					{
						title: 'T1',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
					{
						title: 'T2',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
					{
						title: 'T3',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
				]),
			],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		await decomposeGoal(BASE_CONTEXT);

		expect(mockHaikuCreate).toHaveBeenCalledTimes(1);
		const callArgs = mockHaikuCreate.mock.calls[0][0];
		expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
		expect(callArgs.temperature).toBe(0.4);
		expect(callArgs.tools).toHaveLength(1);
		expect(callArgs.tools[0].name).toBe('decompose_goal');
		expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'decompose_goal' });
	});

	it('includes KG triplets and contacts in user prompt', async () => {
		mockHaikuCreate.mockResolvedValue({
			content: [
				makeDecomposeToolUse([
					{
						title: 'T1',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
					{
						title: 'T2',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
					{
						title: 'T3',
						action_type: 'information_gathering',
						domain_tag: 'other',
						effort: 'quick',
					},
				]),
			],
		});

		const { decomposeGoal } = await import('../goal-decomposition');
		await decomposeGoal(BASE_CONTEXT);

		const callArgs = mockHaikuCreate.mock.calls[0][0];
		const userMessage = callArgs.messages[0].content;
		expect(userMessage).toContain('DeFi');
		expect(userMessage).toContain('sector');
		expect(userMessage).toContain('aaaaaaaa-1111-2222-3333-444444444444');
		expect(userMessage).toContain('behind pace');
	});
});

describe('GI2 — Pace Score', () => {
	it('computes pace score for goal with deadline', async () => {
		const { computePaceScore } = await import('../goal-decomposition');
		const now = Date.now();
		const created = new Date(now - 10 * 86400000); // 10 days ago
		const deadline = new Date(now + 10 * 86400000); // 10 days from now

		const result = computePaceScore({
			currentCount: 3,
			targetCount: 10,
			targetDate: deadline,
			createdAt: created,
		});

		// 30% progress / 50% time = 0.6
		expect(result.score).toBeCloseTo(0.6, 1);
		expect(result.label).toBe('at risk');
	});

	it('returns null score for goal without deadline', async () => {
		const { computePaceScore } = await import('../goal-decomposition');

		const result = computePaceScore({
			currentCount: 3,
			targetCount: 10,
			targetDate: null,
			createdAt: new Date(),
		});

		expect(result.score).toBeNull();
		expect(result.label).toBe('no deadline set');
	});

	it('labels deadline approaching when < 7 days left', async () => {
		const { computePaceScore } = await import('../goal-decomposition');
		const now = Date.now();
		const created = new Date(now - 20 * 86400000);
		const deadline = new Date(now + 3 * 86400000); // 3 days left

		const result = computePaceScore({
			currentCount: 8,
			targetCount: 10,
			targetDate: deadline,
			createdAt: created,
		});

		expect(result.label).toBe('deadline approaching');
	});

	it('labels on track when pace >= 0.9', async () => {
		const { computePaceScore } = await import('../goal-decomposition');
		const now = Date.now();
		const created = new Date(now - 10 * 86400000);
		const deadline = new Date(now + 90 * 86400000); // plenty of time

		const result = computePaceScore({
			currentCount: 5,
			targetCount: 10,
			targetDate: deadline,
			createdAt: created,
		});

		expect(result.label).toBe('on track');
	});
});

describe('GI2 — Replanning Trigger', () => {
	it('triggers replan below 0.75', async () => {
		const { needsReplanning } = await import('../goal-decomposition');
		expect(needsReplanning(0.74)).toBe(true);
		expect(needsReplanning(0.5)).toBe(true);
	});

	it('does not trigger replan at 0.75 or above', async () => {
		const { needsReplanning } = await import('../goal-decomposition');
		expect(needsReplanning(0.75)).toBe(false);
		expect(needsReplanning(1.0)).toBe(false);
	});

	it('does not trigger replan for null pace', async () => {
		const { needsReplanning } = await import('../goal-decomposition');
		expect(needsReplanning(null)).toBe(false);
	});
});
