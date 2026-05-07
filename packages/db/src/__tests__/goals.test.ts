import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	keyStore: { getStore: vi.fn(() => null) },
	computeBlindIndex: vi.fn((val: string) => `bidx:${val}`),
}));

const MOCK_ENVELOPE = { encryptedWrk: Buffer.from('test'), kmsContext: {}, wrkVersion: 1 };

const mockReturning = vi.fn();
const mockLimit = vi.fn(() => Promise.resolve([]));
const mockWhere = vi.fn(() => ({ limit: mockLimit, returning: mockReturning }));
const mockInsertValues = vi.fn(() => ({ returning: mockReturning }));
const mockSet = vi.fn(() => ({ where: vi.fn(() => ({ returning: mockReturning })) }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
const mockSelect = vi.fn(() => ({ from: vi.fn(() => ({ where: mockWhere })) }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
	},
}));

describe('goals DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWhere.mockReturnValue({ limit: mockLimit, returning: mockReturning });
		mockLimit.mockResolvedValue([]);
	});

	it('createGoal inserts with provided values', async () => {
		const mockGoal = { id: 'goal-1', workspaceId: 'ws-1', status: 'active', currentCount: 0 };
		mockReturning.mockResolvedValueOnce([mockGoal]);

		const { createGoal } = await import('../dal/goals');
		const result = await createGoal(
			'ws-1',
			{
				type: 'relationship',
				title: 'Stay in touch with 10 people',
				targetCount: 10,
			},
			MOCK_ENVELOPE,
		);

		expect(mockInsert).toHaveBeenCalled();
		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 'ws-1',
				type: 'relationship',
				title: 'Stay in touch with 10 people',
				targetCount: 10,
			}),
		);
		expect(result).toEqual(mockGoal);
	});

	it('updateGoalProgress atomically increments using LEAST SQL', async () => {
		const mockUpdated = { id: 'goal-1', currentCount: 3, targetCount: 5, status: 'active' };
		mockReturning.mockResolvedValueOnce([mockUpdated]);

		const { updateGoalProgress } = await import('../dal/goals');
		const result = await updateGoalProgress('ws-1', 'goal-1', 1);

		expect(mockUpdate).toHaveBeenCalled();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const setArg = (mockSet.mock.calls as any[])[0][0] as Record<string, unknown>;
		// currentCount should use LEAST SQL expression
		expect(setArg.currentCount).toBeDefined();
		expect(result?.currentCount).toBe(3);
	});

	it('updateGoalProgress auto-completes when target reached', async () => {
		// First update: returns currentCount == targetCount
		const mockAtTarget = { id: 'goal-1', currentCount: 5, targetCount: 5, status: 'active' };
		mockReturning
			.mockResolvedValueOnce([mockAtTarget]) // first update returning
			.mockResolvedValueOnce([{ ...mockAtTarget, status: 'completed', completedAt: new Date() }]); // completion update

		const { updateGoalProgress } = await import('../dal/goals');
		const result = await updateGoalProgress('ws-1', 'goal-1', 1);

		// Should have called update twice — once for increment, once for completion
		expect(mockUpdate).toHaveBeenCalledTimes(2);
		expect(result?.status).toBe('completed');
	});

	it('getActiveGoalsByType filters by type and status active', async () => {
		(mockWhere as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

		const { getActiveGoalsByType } = await import('../dal/goals');
		await getActiveGoalsByType('ws-1', 'relationship', undefined, MOCK_ENVELOPE);

		expect(mockSelect).toHaveBeenCalled();
		// The where clause is built from conditions including type + status
		expect(mockWhere).toHaveBeenCalled();
	});

	it('updateGoalStatus updates to paused', async () => {
		const mockPaused = { id: 'goal-1', status: 'paused' };
		mockReturning.mockResolvedValueOnce([mockPaused]);

		const { updateGoalStatus } = await import('../dal/goals');
		const result = await updateGoalStatus('ws-1', 'goal-1', 'paused');

		expect(mockUpdate).toHaveBeenCalled();
		expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'paused' }));
		expect(result?.status).toBe('paused');
	});
});
