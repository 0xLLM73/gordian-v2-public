import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferWithCache = vi.hoisted(() => vi.fn());
const mockSelectPromptVariant = vi.hoisted(() => vi.fn());

vi.mock('../cached-inference', () => ({
	inferWithCache: mockInferWithCache,
}));

vi.mock('../bandit', () => ({
	selectPromptVariant: mockSelectPromptVariant,
}));

import { generateDraft, generateDraftWithBandit } from '../draft-generation';

const textResponse = (text: string) => ({
	stop_reason: 'end_turn',
	content: [{ type: 'text', text }],
});

describe('generateDraft', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('appends arm-specific style instructions to system kernel', async () => {
		mockInferWithCache.mockResolvedValue(textResponse('Hi Alice!'));

		await generateDraft('Alice is a VC', 'Recent msgs', 'casual_nudge');

		const systemArg = mockInferWithCache.mock.calls[0][0] as string;
		expect(systemArg).toContain('Casual and friendly');
		expect(systemArg).toContain('drafting assistant');
	});

	it('uses default (empty) modifier for unknown arm type', async () => {
		mockInferWithCache.mockResolvedValue(textResponse('Hello.'));

		await generateDraft('Summary', 'Messages', 'unknown_arm');

		const systemArg = mockInferWithCache.mock.calls[0][0] as string;
		// No extra style modifier appended — just base kernel
		expect(systemArg).not.toContain('Style:');
	});

	it('passes correct Helicone metadata (feature + banditArm)', async () => {
		mockInferWithCache.mockResolvedValue(textResponse('Draft text'));

		await generateDraft('Summary', 'Messages', 'professional_value');

		expect(mockInferWithCache).toHaveBeenCalledWith(
			expect.any(String),
			'',
			'',
			expect.any(Array),
			expect.objectContaining({
				helicone: { feature: 'draft-generation', banditArm: 'professional_value' },
				maxTokens: 512,
				temperature: 0.7,
			}),
		);
	});

	it('extracts text from content blocks', async () => {
		mockInferWithCache.mockResolvedValue({
			stop_reason: 'end_turn',
			content: [
				{ type: 'text', text: 'Hello Alice, ' },
				{ type: 'text', text: 'hope you are well.' },
			],
		});

		const result = await generateDraft('Summary', 'Messages', 'direct_ask');

		expect(result).toBe('Hello Alice, \nhope you are well.');
	});
});

describe('generateDraftWithBandit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('calls selectPromptVariant with "draft_generation" domain', async () => {
		mockSelectPromptVariant.mockResolvedValue({ variant: 'casual_nudge', traceId: 'trace-1' });
		mockInferWithCache.mockResolvedValue(textResponse('Hey!'));

		await generateDraftWithBandit('Summary', 'Messages', 'user-abc');

		expect(mockSelectPromptVariant).toHaveBeenCalledWith(
			'draft_generation',
			expect.arrayContaining(['casual_nudge', 'professional_value', 'direct_ask', 'soft_memory']),
			'user-abc',
		);
	});

	it('returns { text, armType, traceId }', async () => {
		mockSelectPromptVariant.mockResolvedValue({ variant: 'soft_memory', traceId: 'trace-xyz' });
		mockInferWithCache.mockResolvedValue(textResponse('Remember when we met at the conference?'));

		const result = await generateDraftWithBandit('Summary', 'Messages', 'user-123');

		expect(result.text).toBe('Remember when we met at the conference?');
		expect(result.armType).toBe('soft_memory');
		expect(result.traceId).toBe('trace-xyz');
	});
});
