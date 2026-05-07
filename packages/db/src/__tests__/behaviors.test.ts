import { beforeEach, describe, expect, it, vi } from 'vitest';

type BehaviorCount = { event: string; count: number };

const mockReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
const mockGroupBy = vi.fn(() => ({ orderBy: vi.fn(() => Promise.resolve([] as BehaviorCount[])) }));
const mockWhere = vi.fn(() => ({ groupBy: mockGroupBy }));
const mockSelect = vi.fn(() => ({ from: vi.fn(() => ({ where: mockWhere })) }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		select: mockSelect,
	},
}));

describe('behaviors DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('trackBehavior inserts event with metadata', async () => {
		const mockRow = { id: 'b-1', workspaceId: 'ws-1', event: 'view_contact' };
		mockReturning.mockResolvedValueOnce([mockRow]);

		const { trackBehavior } = await import('../dal/behaviors');
		const result = await trackBehavior('ws-1', 'user-1', 'view_contact', { contactId: 'c-1' });

		expect(mockInsert).toHaveBeenCalled();
		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 'ws-1',
				userId: 'user-1',
				event: 'view_contact',
				metadata: { contactId: 'c-1' },
			}),
		);
		expect(result).toEqual(mockRow);
	});

	it('trackBehavior handles null metadata when not provided', async () => {
		mockReturning.mockResolvedValueOnce([{ id: 'b-2' }]);

		const { trackBehavior } = await import('../dal/behaviors');
		await trackBehavior('ws-1', 'user-1', 'open_app');

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: null,
			}),
		);
	});

	it('getBehaviorCounts aggregates by event with groupBy', async () => {
		const mockCounts = [
			{ event: 'view_contact', count: 42 },
			{ event: 'open_app', count: 10 },
		];
		mockGroupBy.mockReturnValueOnce({ orderBy: vi.fn(() => Promise.resolve(mockCounts)) });

		const { getBehaviorCounts } = await import('../dal/behaviors');
		const result = await getBehaviorCounts('ws-1');

		expect(mockSelect).toHaveBeenCalled();
		expect(mockGroupBy).toHaveBeenCalled();
		expect(result).toEqual(mockCounts);
	});
});
