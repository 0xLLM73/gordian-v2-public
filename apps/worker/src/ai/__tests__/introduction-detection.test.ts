import { describe, expect, it, vi } from 'vitest';
import { hasIntroKeywords } from '../introduction-detection';

// Mock inferWithCache
vi.mock('../cached-inference', () => ({
	inferWithCache: vi.fn(),
}));

describe('introduction-detection', () => {
	it('hasIntroKeywords returns false when no keywords present', () => {
		expect(hasIntroKeywords('We discussed the Q3 earnings report.')).toBe(false);
	});

	it('hasIntroKeywords returns true when keywords present', () => {
		expect(hasIntroKeywords('Let me introduce you to Alice.')).toBe(true);
		expect(hasIntroKeywords('I want to connect you with Bob.')).toBe(true);
		expect(hasIntroKeywords('Adding Charlie to the group for context.')).toBe(true);
	});

	it('detectIntroductions parses tool_use response', async () => {
		const { inferWithCache } = await import('../cached-inference');
		const mockInfer = vi.mocked(inferWithCache);

		mockInfer.mockResolvedValue({
			content: [
				{
					type: 'tool_use',
					id: 'call-1',
					name: 'detect_introductions',
					input: {
						introductions: [
							{
								introducer_name: 'PERSON_a1b2',
								introduced_name_1: 'PERSON_c3d4',
								introduced_name_2: 'PERSON_e5f6',
								context: 'deal',
								confidence: 0.9,
								reasoning: 'Explicit introduction',
							},
						],
					},
				},
			],
		} as never);

		const { detectIntroductions } = await import('../introduction-detection');
		const result = await detectIntroductions('PERSON_a1b2 introduced PERSON_c3d4 to PERSON_e5f6');

		expect(result).toHaveLength(1);
		expect(result[0].introducer_name).toBe('PERSON_a1b2');
		expect(result[0].confidence).toBe(0.9);
	});

	it('detectIntroductions handles malformed response', async () => {
		const { inferWithCache } = await import('../cached-inference');
		const mockInfer = vi.mocked(inferWithCache);

		mockInfer.mockResolvedValue({
			content: [{ type: 'text', text: 'No introductions found' }],
		} as never);

		const { detectIntroductions } = await import('../introduction-detection');
		const result = await detectIntroductions('Some random text');

		expect(result).toEqual([]);
	});
});
