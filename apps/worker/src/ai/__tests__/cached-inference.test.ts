import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the cached inference module.
 * Verifies the prompt structure (system array with cache_control breakpoints)
 * without making actual API calls.
 */

// Track all create calls across instances
const createSpy = vi.fn().mockResolvedValue({
	content: [{ type: 'text', text: 'Mock response' }],
	usage: { input_tokens: 100, output_tokens: 50 },
});

vi.mock('@anthropic-ai/sdk', () => {
	return {
		default: class MockAnthropic {
			messages = { create: createSpy };
		},
	};
});

// Import after mock setup
const { getHeliconeHeaders, inferWithCache } = await import('../cached-inference');

describe('inferWithCache', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('builds system array with cache_control breakpoints', async () => {
		createSpy.mockClear();

		const response = await inferWithCache(
			'System kernel text',
			'Golden library examples',
			'Domain knowledge',
			[{ role: 'user', content: 'Hello' }],
		);

		expect(response.content[0]).toEqual({ type: 'text', text: 'Mock response' });
		expect(createSpy).toHaveBeenCalledTimes(1);

		const callArgs = createSpy.mock.calls[0][0];

		// System should be an array with cache_control on layers 1 and 2
		expect(Array.isArray(callArgs.system)).toBe(true);
		expect(callArgs.system.length).toBe(3); // kernel + golden + domain

		// Layer 1: system kernel with cache_control (1h TTL)
		expect(callArgs.system[0]).toEqual({
			type: 'text',
			text: 'System kernel text',
			cache_control: { type: 'ephemeral', ttl: '1h' },
		});

		// Layer 2: golden library with cache_control (1h TTL)
		expect(callArgs.system[1]).toEqual({
			type: 'text',
			text: 'Golden library examples',
			cache_control: { type: 'ephemeral', ttl: '1h' },
		});

		// Layer 3: domain knowledge WITHOUT cache_control
		expect(callArgs.system[2]).toEqual({
			type: 'text',
			text: 'Domain knowledge',
		});

		// Layer 4: messages
		expect(callArgs.messages).toEqual([{ role: 'user', content: 'Hello' }]);
	});

	it('omits empty golden library layer', async () => {
		createSpy.mockClear();

		await inferWithCache(
			'System kernel',
			'', // Empty golden library
			'',
			[{ role: 'user', content: 'Test' }],
		);

		const callArgs = createSpy.mock.calls[0][0];

		// Should only have 1 system block (kernel), no empty layers
		expect(callArgs.system.length).toBe(1);
		expect(callArgs.system[0].text).toBe('System kernel');
		expect(callArgs.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
	});

	it('omits empty domain knowledge layer', async () => {
		createSpy.mockClear();

		await inferWithCache(
			'Kernel',
			'Golden examples',
			'', // Empty domain knowledge
			[{ role: 'user', content: 'Test' }],
		);

		const callArgs = createSpy.mock.calls[0][0];

		// Should have 2 system blocks (kernel + golden), no empty domain
		expect(callArgs.system.length).toBe(2);
	});

	it('uses correct model and defaults', async () => {
		createSpy.mockClear();

		await inferWithCache('K', '', '', [{ role: 'user', content: 'T' }]);

		const callArgs = createSpy.mock.calls[0][0];

		expect(callArgs.model).toBe('claude-sonnet-4-6');
		expect(callArgs.max_tokens).toBe(2048);
		expect(callArgs.temperature).toBe(0.3);
	});

	it('passes custom options through', async () => {
		createSpy.mockClear();

		await inferWithCache('K', '', '', [{ role: 'user', content: 'T' }], {
			maxTokens: 512,
			temperature: 0.7,
		});

		const callArgs = createSpy.mock.calls[0][0];

		expect(callArgs.max_tokens).toBe(512);
		expect(callArgs.temperature).toBe(0.7);
	});

	it('keeps Helicone headers off unless explicitly enabled', () => {
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		vi.stubEnv('HELICONE_API_KEY', 'helicone-key');
		vi.stubEnv('HELICONE_ENABLED', 'false');

		expect(getHeliconeHeaders({ feature: 'test-feature' })).toEqual({});

		vi.stubEnv('HELICONE_ENABLED', 'true');
		expect(getHeliconeHeaders({ feature: 'test-feature' })).toEqual(
			expect.objectContaining({
				'Helicone-Property-Feature': 'test-feature',
			}),
		);
	});
});
