import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLimit = vi.hoisted(() => vi.fn());
const mockOrderBy = vi.hoisted(() => vi.fn((): unknown => ({ limit: mockLimit })));
const mockWhere = vi.hoisted(() => vi.fn(() => ({ orderBy: mockOrderBy })));
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
	},
}));

const WORKSPACE_ID = 'ws-00000000-0000-0000-0000-000000000001';

describe('health score DAL reads', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLimit.mockResolvedValue([]);
	});

	it('can query low-scoring health labels directly', async () => {
		const { getHealthScoresByWorkspace } = await import('../dal/health-scores');
		const rows = [{ contactId: 'contact-1', label: 'cooling', composite: 0.32 }];
		mockLimit.mockResolvedValueOnce(rows);

		const result = await getHealthScoresByWorkspace(WORKSPACE_ID, {
			labels: ['dormant', 'cooling'],
			sort: 'composite_asc',
			limit: 5,
		});

		expect(result).toBe(rows);
		expect(mockWhere).toHaveBeenCalledTimes(1);
		expect(mockOrderBy).toHaveBeenCalledTimes(1);
		expect(mockLimit).toHaveBeenCalledWith(5);
	});

	it('skips contact-id health lookup when no contacts are provided', async () => {
		const { getHealthScoresByContactIds } = await import('../dal/health-scores');

		await expect(getHealthScoresByContactIds(WORKSPACE_ID, [])).resolves.toEqual([]);
		expect(mockSelect).not.toHaveBeenCalled();
	});

	it('fetches health scores for an explicit contact-id set', async () => {
		const { getHealthScoresByContactIds } = await import('../dal/health-scores');
		const rows = [{ contactId: 'contact-2', label: 'dormant', composite: 0.18 }];
		mockOrderBy.mockResolvedValueOnce(rows);

		const result = await getHealthScoresByContactIds(WORKSPACE_ID, ['contact-1', 'contact-2']);

		expect(result).toBe(rows);
		expect(mockWhere).toHaveBeenCalledTimes(1);
		expect(mockOrderBy).toHaveBeenCalledTimes(1);
		expect(mockLimit).not.toHaveBeenCalled();
	});
});
