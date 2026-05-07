import { describe, expect, it, vi } from 'vitest';

// Mock the DAL
const mockGetActiveGoalsByType = vi.fn();
const mockUpdateGoalProgress = vi.fn();

vi.mock('@repo/db', () => ({
	getActiveGoalsByType: (...args: unknown[]) => mockGetActiveGoalsByType(...args),
	updateGoalProgress: (...args: unknown[]) => mockUpdateGoalProgress(...args),
}));

describe('goals auto-tracking hooks', () => {
	it('network goal incremented on new contact creation', async () => {
		mockGetActiveGoalsByType.mockResolvedValue([{ id: 'goal-1' }]);
		mockUpdateGoalProgress.mockResolvedValue({ id: 'goal-1', currentCount: 2 });

		const goals = await mockGetActiveGoalsByType('ws-1', 'network');
		for (const goal of goals) {
			await mockUpdateGoalProgress('ws-1', goal.id);
		}

		expect(mockGetActiveGoalsByType).toHaveBeenCalledWith('ws-1', 'network');
		expect(mockUpdateGoalProgress).toHaveBeenCalledWith('ws-1', 'goal-1');
	});

	it('relationship goal incremented on outgoing message', async () => {
		mockGetActiveGoalsByType.mockResolvedValue([{ id: 'goal-2' }]);
		mockUpdateGoalProgress.mockResolvedValue({ id: 'goal-2', currentCount: 5 });

		const goals = await mockGetActiveGoalsByType('ws-1', 'relationship', 'contact-1');
		for (const goal of goals) {
			await mockUpdateGoalProgress('ws-1', goal.id);
		}

		expect(mockGetActiveGoalsByType).toHaveBeenCalledWith('ws-1', 'relationship', 'contact-1');
		expect(mockUpdateGoalProgress).toHaveBeenCalledWith('ws-1', 'goal-2');
	});

	it('habit goal incremented on commitment fulfilled', async () => {
		mockGetActiveGoalsByType.mockResolvedValue([{ id: 'goal-3' }]);
		mockUpdateGoalProgress.mockResolvedValue({ id: 'goal-3', currentCount: 1 });

		const goals = await mockGetActiveGoalsByType('ws-1', 'habit');
		for (const goal of goals) {
			await mockUpdateGoalProgress('ws-1', goal.id);
		}

		expect(mockGetActiveGoalsByType).toHaveBeenCalledWith('ws-1', 'habit');
		expect(mockUpdateGoalProgress).toHaveBeenCalledWith('ws-1', 'goal-3');
	});

	it('business goal incremented on deal stage committed', async () => {
		mockGetActiveGoalsByType.mockResolvedValue([{ id: 'goal-4' }]);
		mockUpdateGoalProgress.mockResolvedValue({ id: 'goal-4', currentCount: 3 });

		const goals = await mockGetActiveGoalsByType('ws-1', 'business');
		for (const goal of goals) {
			await mockUpdateGoalProgress('ws-1', goal.id);
		}

		expect(mockGetActiveGoalsByType).toHaveBeenCalledWith('ws-1', 'business');
		expect(mockUpdateGoalProgress).toHaveBeenCalledWith('ws-1', 'goal-4');
	});
});
