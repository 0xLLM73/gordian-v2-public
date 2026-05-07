import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for the contact summary generation module.
 * Verifies entity masking, message truncation, bandit integration,
 * and Helicone attribution without making actual API calls.
 */

// Mock inferWithCache
const inferWithCacheSpy = vi.fn().mockResolvedValue({
	content: [{ type: 'text', text: 'OVERVIEW:\n- Test summary content for the contact.' }],
	usage: { input_tokens: 200, output_tokens: 100 },
});

vi.mock('../cached-inference', () => ({
	inferWithCache: inferWithCacheSpy,
}));

// Mock bandit
const selectPromptVariantSpy = vi.fn().mockResolvedValue({
	variant: 'summary_formal',
	traceId: '00000000-0000-0000-0000-000000000001',
});

vi.mock('../bandit', () => ({
	selectPromptVariant: selectPromptVariantSpy,
}));

// Mock entity masking
const maskEntitiesSpy = vi.fn().mockImplementation((text: string) => ({
	maskedText: text.replace(/John/g, '[PERSON_1]'),
	mappings: [],
}));

vi.mock('@repo/crypto', () => ({
	maskEntities: maskEntitiesSpy,
}));

// Mock prefilter — returns predictable entities so we can verify they're passed to maskEntities
const mockDetectedEntity = { text: 'john@example.com', type: 'EMAIL' as const, start: 4, end: 20 };
const prefilterEntitiesSpy = vi.fn().mockReturnValue([mockDetectedEntity]);

vi.mock('../prefilter', () => ({
	prefilterEntities: prefilterEntitiesSpy,
}));

const { generateContactSummary } = await import('../contact-summary');

describe('generateContactSummary', () => {
	const baseInput = {
		contactId: '00000000-0000-0000-0000-000000000002',
		contactName: 'Test Contact',
		workspaceId: '00000000-0000-0000-0000-000000000003',
		messages: [
			{ role: 'user', content: 'Hey John, how are you?', timestamp: '2026-01-01T10:00:00Z' },
			{
				role: 'contact',
				content: 'Good! John is doing well.',
				timestamp: '2026-01-01T10:01:00Z',
			},
		],
		commitmentsSummary: 'Send report by Friday',
		workspaceSalt: Buffer.from('test-salt'),
	};

	it('calls inferWithCache with correct 4-layer structure', async () => {
		inferWithCacheSpy.mockClear();
		selectPromptVariantSpy.mockClear();

		await generateContactSummary(baseInput, 'user-123');

		expect(inferWithCacheSpy).toHaveBeenCalledTimes(1);

		const [systemKernel, goldenLibrary, domainKnowledge, messages, _options] =
			inferWithCacheSpy.mock.calls[0];

		// Layer 1: system kernel should include style modifier
		expect(systemKernel).toContain('relationship intelligence engine');
		expect(systemKernel).toContain('executive briefing'); // formal variant modifier

		// Layer 2: golden library empty for now
		expect(goldenLibrary).toBe('');

		// Layer 3: domain knowledge empty
		expect(domainKnowledge).toBe('');

		// Layer 4: user messages
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe('user');
		expect(messages[0].content).toContain('Test Contact');
		expect(messages[0].content).toContain('Send report by Friday');
	});

	it('calls prefilterEntities for each message then passes result to maskEntities', async () => {
		maskEntitiesSpy.mockClear();
		inferWithCacheSpy.mockClear();
		prefilterEntitiesSpy.mockClear();

		await generateContactSummary(baseInput);

		// prefilterEntities called once per message
		expect(prefilterEntitiesSpy).toHaveBeenCalledTimes(2);
		expect(prefilterEntitiesSpy).toHaveBeenCalledWith('Hey John, how are you?');

		// maskEntities called with the entity list from prefilterEntities (not [])
		expect(maskEntitiesSpy).toHaveBeenCalledTimes(2);
		expect(maskEntitiesSpy).toHaveBeenCalledWith(
			'Hey John, how are you?',
			baseInput.workspaceSalt,
			[mockDetectedEntity],
		);

		// The user prompt sent to inferWithCache should contain masked text
		const userPrompt = inferWithCacheSpy.mock.calls[0][3][0].content;
		expect(userPrompt).toContain('[PERSON_1]');
	});

	it('truncates messages to 200 when input exceeds limit', async () => {
		inferWithCacheSpy.mockClear();
		maskEntitiesSpy.mockClear();

		const manyMessages = Array.from({ length: 250 }, (_, i) => ({
			role: i % 2 === 0 ? 'user' : 'contact',
			content: `Message ${i}`,
			timestamp: `2026-01-01T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
		}));

		await generateContactSummary({ ...baseInput, messages: manyMessages });

		// maskEntities called for all 250 messages (masking happens before truncation)
		expect(maskEntitiesSpy).toHaveBeenCalledTimes(250);

		// But the prompt should indicate truncation
		const userPrompt = inferWithCacheSpy.mock.calls[0][3][0].content;
		expect(userPrompt).toContain('Messages analyzed: 200 (of 250 total)');
	});

	it('includes Helicone metadata with feature name and bandit arm', async () => {
		inferWithCacheSpy.mockClear();

		await generateContactSummary(baseInput);

		const options = inferWithCacheSpy.mock.calls[0][4];
		expect(options.helicone).toEqual({
			feature: 'contact-summary',
			banditArm: 'summary_formal',
		});
	});

	it('returns structured result with model, messageCount, traceId, variant', async () => {
		inferWithCacheSpy.mockClear();

		const result = await generateContactSummary(baseInput, 'user-123');

		expect(result).toEqual({
			summary: 'OVERVIEW:\n- Test summary content for the contact.',
			model: 'claude-sonnet-4-6',
			messageCount: 2,
			traceId: '00000000-0000-0000-0000-000000000001',
			variant: 'summary_formal',
		});
	});

	it('selects variant via Thompson Sampling', async () => {
		selectPromptVariantSpy.mockClear();

		await generateContactSummary(baseInput, 'user-456');

		expect(selectPromptVariantSpy).toHaveBeenCalledWith(
			'contact_summary',
			['summary_formal', 'summary_casual'],
			'user-456',
		);
	});
});
