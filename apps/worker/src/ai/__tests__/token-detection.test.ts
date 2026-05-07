import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasTokenKeywords } from '../token-detection';

// Mock inferWithCache
vi.mock('../cached-inference', () => ({
	inferWithCache: vi.fn(),
}));

// Mock maskEntities so we can assert it's called with the entity list
const mockMaskEntities = vi.hoisted(() =>
	vi.fn(
		(
			text: string,
			_salt: Buffer,
			_entities: Array<{ type: string; text: string; start: number; end: number }>,
		) => ({
			maskedText: `[MASKED]${text}`,
			entityMap: [],
		}),
	),
);
vi.mock('@repo/crypto', () => ({
	maskEntities: mockMaskEntities,
	prefilterEntities: vi.fn((text: string) => {
		const entities: Array<{ type: string; text: string; start: number; end: number }> = [];
		const emailRe = /[\w.+-]+@[\w.-]+\.\w+/g;
		for (const match of text.matchAll(emailRe)) {
			entities.push({
				type: 'EMAIL',
				text: match[0],
				start: match.index,
				end: match.index + match[0].length,
			});
		}
		return entities;
	}),
}));

describe('token-detection', () => {
	describe('hasTokenKeywords', () => {
		it('returns false for text without crypto keywords', () => {
			expect(hasTokenKeywords('We had a meeting about the quarterly report.')).toBe(false);
			expect(hasTokenKeywords('Please send the document by Friday.')).toBe(false);
		});

		it('returns true for text with common crypto keywords', () => {
			expect(hasTokenKeywords('I just bought some BTC.')).toBe(true);
			expect(hasTokenKeywords('Ethereum is looking bullish today.')).toBe(true);
			expect(hasTokenKeywords('The token price is pumping.')).toBe(true);
			expect(hasTokenKeywords('Check the $SOL chart.')).toBe(true);
			expect(hasTokenKeywords('DeFi yields are down.')).toBe(true);
		});

		it('is case-insensitive', () => {
			expect(hasTokenKeywords('BITCOIN will hit 100k.')).toBe(true);
			expect(hasTokenKeywords('Staking rewards are great.')).toBe(true);
		});
	});

	describe('detectTokenMentions', () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it('returns empty array for short text', async () => {
			const { detectTokenMentions } = await import('../token-detection');
			const result = await detectTokenMentions('hi');
			expect(result).toEqual([]);
		});

		it('returns empty array for text without keywords', async () => {
			const { detectTokenMentions } = await import('../token-detection');
			const result = await detectTokenMentions(
				'We had a productive meeting about the project timeline.',
			);
			expect(result).toEqual([]);
		});

		it('parses valid JSON array from LLM response', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockResolvedValue({
				content: [
					{
						type: 'text',
						text: JSON.stringify([
							{
								symbol: 'BTC',
								name: 'Bitcoin',
								context: 'Discussing Bitcoin price targets',
								confidence: 0.95,
							},
							{
								symbol: 'ETH',
								name: 'Ethereum',
								context: 'Ethereum staking yields',
								confidence: 0.85,
							},
						]),
					},
				],
			} as never);

			const { detectTokenMentions } = await import('../token-detection');
			const result = await detectTokenMentions(
				'I think BTC will hit 150k and ETH staking yields are great',
			);

			expect(result).toHaveLength(2);
			expect(result[0].symbol).toBe('BTC');
			expect(result[0].confidence).toBe(0.95);
			expect(result[1].symbol).toBe('ETH');
		});

		it('calls inferWithCache with correct positional args', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockResolvedValue({
				content: [{ type: 'text', text: '[]' }],
			} as never);

			const { detectTokenMentions } = await import('../token-detection');
			await detectTokenMentions('BTC is looking bullish today');

			expect(mockInfer).toHaveBeenCalledWith(
				expect.any(String), // systemKernel
				'', // goldenLibrary
				'', // domainKnowledge
				[{ role: 'user', content: expect.any(String) }], // userMessages
				{ temperature: 0.1, maxTokens: 256, helicone: { feature: 'token-detection' } }, // options
			);
			// Verify 5 positional args (not an object)
			expect(mockInfer.mock.calls[0]).toHaveLength(5);
		});

		it('filters out low-confidence mentions', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockResolvedValue({
				content: [
					{
						type: 'text',
						text: JSON.stringify([
							{ symbol: 'SOL', name: 'Solana', context: 'Clear mention', confidence: 0.9 },
							{ symbol: 'LINK', name: 'Chainlink', context: 'Ambiguous', confidence: 0.3 },
						]),
					},
				],
			} as never);

			const { detectTokenMentions } = await import('../token-detection');
			const result = await detectTokenMentions('SOL is pumping, also check the link I sent');

			expect(result).toHaveLength(1);
			expect(result[0].symbol).toBe('SOL');
		});

		it('handles malformed JSON response gracefully', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockResolvedValue({
				content: [{ type: 'text', text: 'not valid json' }],
			} as never);

			const { detectTokenMentions } = await import('../token-detection');
			const result = await detectTokenMentions('BTC is going up, crypto market is hot');

			expect(result).toEqual([]);
		});

		it('handles non-array JSON response', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockResolvedValue({
				content: [{ type: 'text', text: JSON.stringify({ error: 'no tokens found' }) }],
			} as never);

			const { detectTokenMentions } = await import('../token-detection');
			const result = await detectTokenMentions('Something about crypto trading');

			expect(result).toEqual([]);
		});

		it('handles non-text content block', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockResolvedValue({
				content: [{ type: 'tool_use', id: 'tool-1', name: 'test', input: {} }],
			} as never);

			const { detectTokenMentions } = await import('../token-detection');
			const result = await detectTokenMentions('BTC is pumping hard today');

			expect(result).toEqual([]);
		});

		it('filters entries without symbol field', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockResolvedValue({
				content: [
					{
						type: 'text',
						text: JSON.stringify([
							{ symbol: 'BTC', name: 'Bitcoin', context: 'Valid', confidence: 0.9 },
							{ name: 'Unknown', context: 'Missing symbol', confidence: 0.8 },
						]),
					},
				],
			} as never);

			const { detectTokenMentions } = await import('../token-detection');
			const result = await detectTokenMentions('BTC and some unknown token in the crypto space');

			expect(result).toHaveLength(1);
			expect(result[0].symbol).toBe('BTC');
		});

		it('propagates inferWithCache errors', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockRejectedValue(new Error('API rate limit exceeded'));

			const { detectTokenMentions } = await import('../token-detection');
			await expect(detectTokenMentions('BTC ETH SOL crypto tokens everywhere')).rejects.toThrow(
				'API rate limit exceeded',
			);
		});

		it('masks entities with prefilter results when workspaceSalt is provided', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockResolvedValue({
				content: [{ type: 'text', text: '[]' }],
			} as never);

			mockMaskEntities.mockClear();

			const { detectTokenMentions } = await import('../token-detection');
			const salt = Buffer.from('test-salt-32-bytes-padded-here!!');
			// Text containing an email (PII that prefilterEntities will detect)
			await detectTokenMentions('BTC is pumping, contact crypto@example.com', salt);

			expect(mockMaskEntities).toHaveBeenCalledTimes(1);
			// Verify entities list is non-empty (prefilterEntities detected the email)
			const [, , entities] = mockMaskEntities.mock.calls[0];
			expect(entities).toBeInstanceOf(Array);
			expect(entities.length).toBeGreaterThan(0);
			expect(entities[0]).toMatchObject({ type: 'EMAIL' });
		});

		it('does not call maskEntities when workspaceSalt is absent', async () => {
			const { inferWithCache } = await import('../cached-inference');
			const mockInfer = vi.mocked(inferWithCache);

			mockInfer.mockResolvedValue({
				content: [{ type: 'text', text: '[]' }],
			} as never);

			mockMaskEntities.mockClear();

			const { detectTokenMentions } = await import('../token-detection');
			// No salt provided — falls back to raw text
			await detectTokenMentions('BTC is trading at 100k today');

			expect(mockMaskEntities).not.toHaveBeenCalled();
		});
	});
});
