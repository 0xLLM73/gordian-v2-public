import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInArray = vi.hoisted(() =>
	vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
);
const mockUpdate = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn());

vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('drizzle-orm')>();
	return {
		...actual,
		inArray: mockInArray,
	};
});

vi.mock('../client', () => ({
	db: {
		update: mockUpdate,
	},
}));

describe('correction diffs DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWhere.mockResolvedValue(undefined);
		mockSet.mockReturnValue({ where: mockWhere });
		mockUpdate.mockReturnValue({ set: mockSet });
	});

	it('assigns a pattern to diffs using an IN predicate instead of raw uuid array binding', async () => {
		const { correctionDiffs } = await import('../schema/correction-diffs');
		const { assignPatternToDiffs } = await import('../dal/correction-diffs');
		const diffIds = [
			'11111111-1111-4111-8111-111111111111',
			'22222222-2222-4222-8222-222222222222',
		];
		const patternId = '33333333-3333-4333-8333-333333333333';

		await assignPatternToDiffs(diffIds, patternId);

		expect(mockUpdate).toHaveBeenCalledWith(correctionDiffs);
		expect(mockSet).toHaveBeenCalledWith({ patternId });
		expect(mockInArray).toHaveBeenCalledWith(correctionDiffs.id, diffIds);
		expect(mockWhere).toHaveBeenCalledWith({ field: correctionDiffs.id, values: diffIds });
	});

	it('skips the update when no diff ids are provided', async () => {
		const { assignPatternToDiffs } = await import('../dal/correction-diffs');

		await assignPatternToDiffs([], '33333333-3333-4333-8333-333333333333');

		expect(mockUpdate).not.toHaveBeenCalled();
		expect(mockInArray).not.toHaveBeenCalled();
	});
});
