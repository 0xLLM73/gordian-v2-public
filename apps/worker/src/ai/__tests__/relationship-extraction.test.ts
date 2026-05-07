import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferWithCache = vi.hoisted(() => vi.fn());
vi.mock('../cached-inference', () => ({
	inferWithCache: mockInferWithCache,
}));

import { extractRelationships } from '../relationship-extraction';

describe('extractRelationships', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns empty array for empty input', async () => {
		const result = await extractRelationships('');
		expect(result).toEqual([]);
		expect(mockInferWithCache).not.toHaveBeenCalled();
	});

	it('returns empty array for whitespace-only input', async () => {
		const result = await extractRelationships('   \n  ');
		expect(result).toEqual([]);
		expect(mockInferWithCache).not.toHaveBeenCalled();
	});

	it('parses relationships from tool_use response', async () => {
		mockInferWithCache.mockResolvedValue({
			content: [
				{
					type: 'tool_use',
					id: 'tu-1',
					name: 'extract_relationships',
					input: {
						relationships: [
							{
								source_name: 'PERSON_a1b2',
								target_name: 'PERSON_c3d4',
								relationship_type: 'investor',
								strength_estimate: 0.8,
								reasoning: 'PERSON_a1b2 invested in PERSON_c3d4 fund',
							},
						],
					},
				},
			],
		});

		const result = await extractRelationships('PERSON_a1b2 invested in PERSON_c3d4 last year.');
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			source_name: 'PERSON_a1b2',
			target_name: 'PERSON_c3d4',
			relationship_type: 'investor',
			strength_estimate: 0.8,
		});
	});

	it('returns empty array when tool_use block is missing', async () => {
		mockInferWithCache.mockResolvedValue({
			content: [{ type: 'text', text: 'No relationships found.' }],
		});

		const result = await extractRelationships('Some text without relationships.');
		expect(result).toEqual([]);
	});

	it('returns empty array for malformed LLM response (wrong tool name)', async () => {
		mockInferWithCache.mockResolvedValue({
			content: [
				{
					type: 'tool_use',
					id: 'tu-2',
					name: 'some_other_tool',
					input: { data: 'unexpected' },
				},
			],
		});

		const result = await extractRelationships('Some content.');
		expect(result).toEqual([]);
	});

	it('returns empty array when relationships field is missing from input', async () => {
		mockInferWithCache.mockResolvedValue({
			content: [
				{
					type: 'tool_use',
					id: 'tu-3',
					name: 'extract_relationships',
					input: {}, // missing relationships key
				},
			],
		});

		const result = await extractRelationships('Some content.');
		expect(result).toEqual([]);
	});

	it('returns empty array when inferWithCache throws', async () => {
		mockInferWithCache.mockRejectedValue(new Error('API timeout'));

		const result = await extractRelationships('Some content.');
		expect(result).toEqual([]);
	});

	it('calls inferWithCache with correct helicone feature tag', async () => {
		mockInferWithCache.mockResolvedValue({
			content: [
				{
					type: 'tool_use',
					id: 'tu-4',
					name: 'extract_relationships',
					input: { relationships: [] },
				},
			],
		});

		await extractRelationships('PERSON_a1b2 met with PERSON_c3d4.');

		expect(mockInferWithCache).toHaveBeenCalledWith(
			expect.any(String),
			'',
			'',
			[{ role: 'user', content: 'PERSON_a1b2 met with PERSON_c3d4.' }],
			expect.objectContaining({
				model: 'claude-haiku-4-5-20251001',
				helicone: { feature: 'relationship-extraction' },
			}),
		);
	});

	it('handles multiple relationships in a single response', async () => {
		mockInferWithCache.mockResolvedValue({
			content: [
				{
					type: 'tool_use',
					id: 'tu-5',
					name: 'extract_relationships',
					input: {
						relationships: [
							{
								source_name: 'PERSON_a1b2',
								target_name: 'PERSON_c3d4',
								relationship_type: 'colleague',
								strength_estimate: 0.6,
								reasoning: 'Work together at same company',
							},
							{
								source_name: 'PERSON_a1b2',
								target_name: 'PERSON_e5f6',
								relationship_type: 'advisor',
								strength_estimate: 0.7,
								reasoning: 'PERSON_e5f6 advises PERSON_a1b2',
							},
						],
					},
				},
			],
		});

		const result = await extractRelationships('Meeting notes with multiple people.');
		expect(result).toHaveLength(2);
		expect(result[0].relationship_type).toBe('colleague');
		expect(result[1].relationship_type).toBe('advisor');
	});
});
