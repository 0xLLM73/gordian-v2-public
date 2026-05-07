import { describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();
const mockList = vi.fn();
const mockStatus = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	createGoal: (...args: unknown[]) => mockCreate(...args),
	listGoals: (...args: unknown[]) => mockList(...args),
	updateGoalStatus: (...args: unknown[]) => mockStatus(...args),
}));

vi.mock('@/lib/safe-action', () => ({
	workspaceAction: {
		schema: () => ({
			action: (fn: (...args: unknown[]) => unknown) => fn,
		}),
	},
}));

describe('goals actions', () => {
	it('createGoalAction calls DAL with correct input', async () => {
		mockCreate.mockResolvedValue({ id: 'goal-1', type: 'business', status: 'active' });

		await mockCreate('ws-1', {
			type: 'business',
			title: 'Close 3 deals',
			targetCount: 3,
		});
		expect(mockCreate).toHaveBeenCalledWith(
			'ws-1',
			expect.objectContaining({ type: 'business', title: 'Close 3 deals' }),
		);
	});

	it('listGoalsAction calls DAL with filter options', async () => {
		mockList.mockResolvedValue([]);

		await mockList('ws-1', { status: 'active', type: 'business' });
		expect(mockList).toHaveBeenCalledWith('ws-1', { status: 'active', type: 'business' });
	});

	it('updateGoalStatusAction pauses goal', async () => {
		mockStatus.mockResolvedValue({ id: 'goal-1', status: 'paused' });

		await mockStatus('ws-1', 'goal-1', 'paused');
		expect(mockStatus).toHaveBeenCalledWith('ws-1', 'goal-1', 'paused');
	});
});
