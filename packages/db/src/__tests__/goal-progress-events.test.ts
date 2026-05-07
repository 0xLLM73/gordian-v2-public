import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	keyStore: { getStore: vi.fn(() => null) },
	computeBlindIndex: vi.fn((val: string) => `bidx:${val}`),
}));

const mockReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
const mockLimit = vi.fn<any>(() => Promise.resolve([]));
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn<any>(() => ({
	limit: mockLimit,
	returning: mockReturning,
	orderBy: mockOrderBy,
}));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockSet = vi.fn(() => ({ where: vi.fn(() => ({ returning: mockReturning })) }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
	},
}));

describe('goal progress events', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		mockWhere.mockReturnValue({
			limit: mockLimit,
			returning: mockReturning,
			orderBy: mockOrderBy,
		});
		mockLimit.mockResolvedValue([]);
	});

	it('updateGoalProgress records a progress event with source', async () => {
		const mockUpdated = { id: 'goal-1', currentCount: 3, targetCount: 5, status: 'active' };
		mockReturning.mockResolvedValueOnce([mockUpdated]);

		const { updateGoalProgress } = await import('../dal/goals');
		await updateGoalProgress('ws-1', 'goal-1', 1, 'network');

		// Should insert a progress event
		expect(mockInsert).toHaveBeenCalled();
		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				goalId: 'goal-1',
				workspaceId: 'ws-1',
				delta: 1,
				source: 'network',
			}),
		);
	});

	it('updateGoalProgress defaults source to manual', async () => {
		const mockUpdated = { id: 'goal-1', currentCount: 2, targetCount: 5, status: 'active' };
		mockReturning.mockResolvedValueOnce([mockUpdated]);

		const { updateGoalProgress } = await import('../dal/goals');
		await updateGoalProgress('ws-1', 'goal-1');

		expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual' }));
	});

	it('updateGoalProgress records event before auto-complete', async () => {
		const mockAtTarget = { id: 'goal-1', currentCount: 5, targetCount: 5, status: 'active' };
		mockReturning
			.mockResolvedValueOnce([mockAtTarget])
			.mockResolvedValueOnce([{ ...mockAtTarget, status: 'completed' }]);

		const { updateGoalProgress } = await import('../dal/goals');
		await updateGoalProgress('ws-1', 'goal-1', 1, 'habit');

		// insert should be called for progress event
		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ source: 'habit', delta: 1 }),
		);
		// update should be called twice (increment + auto-complete)
		expect(mockUpdate).toHaveBeenCalledTimes(2);
	});

	it('updateGoalProgress does not record event when goal not found', async () => {
		mockReturning.mockResolvedValueOnce([]);

		const { updateGoalProgress } = await import('../dal/goals');
		const result = await updateGoalProgress('ws-1', 'goal-missing', 1, 'business');

		expect(result).toBeNull();
		// insert should NOT be called — no progress was made
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('updateGoalProgress passes business source from deals hook', async () => {
		const mockUpdated = { id: 'goal-1', currentCount: 1, targetCount: 10, status: 'active' };
		mockReturning.mockResolvedValueOnce([mockUpdated]);

		const { updateGoalProgress } = await import('../dal/goals');
		await updateGoalProgress('ws-1', 'goal-1', 1, 'business');

		expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ source: 'business' }));
	});

	it('updateGoalProgress passes relationship source from sync hook', async () => {
		const mockUpdated = { id: 'goal-1', currentCount: 4, targetCount: 10, status: 'active' };
		mockReturning.mockResolvedValueOnce([mockUpdated]);

		const { updateGoalProgress } = await import('../dal/goals');
		await updateGoalProgress('ws-1', 'goal-1', 1, 'relationship');

		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ source: 'relationship' }),
		);
	});

	it('listGoalProgressEvents returns events ordered by createdAt desc', async () => {
		const mockEvents = [
			{ id: 'e2', goalId: 'g1', delta: 1, source: 'network', createdAt: new Date() },
			{ id: 'e1', goalId: 'g1', delta: 1, source: 'manual', createdAt: new Date() },
		];
		mockLimit.mockResolvedValueOnce(mockEvents);

		const { listGoalProgressEvents } = await import('../dal/goals');
		const result = await listGoalProgressEvents('ws-1', 'g1');

		expect(mockSelect).toHaveBeenCalled();
		expect(mockWhere).toHaveBeenCalled();
		expect(mockOrderBy).toHaveBeenCalled();
		expect(result).toHaveLength(2);
	});

	it('listGoalProgressEvents respects limit option', async () => {
		mockLimit.mockResolvedValueOnce([]);

		const { listGoalProgressEvents } = await import('../dal/goals');
		await listGoalProgressEvents('ws-1', 'g1', { limit: 10 });

		expect(mockLimit).toHaveBeenCalledWith(10);
	});

	it('listGoalProgressEvents defaults limit to 100', async () => {
		mockLimit.mockResolvedValueOnce([]);

		const { listGoalProgressEvents } = await import('../dal/goals');
		await listGoalProgressEvents('ws-1', 'g1');

		expect(mockLimit).toHaveBeenCalledWith(100);
	});
});
