import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/auth', () => ({
	auth: {
		api: {
			getSession: vi.fn(() =>
				Promise.resolve({
					user: { id: 'user-1', email: 'test@test.com', name: 'Test' },
					session: { id: 'session-1' },
				}),
			),
		},
	},
}));

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONTACT_ID = '550e8400-e29b-41d4-a716-446655440001';
const GOAL_ID = '550e8400-e29b-41d4-a716-446655440002';

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() =>
		Promise.resolve({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: { WorkspaceID: 'mock' },
			wrkVersion: 1,
		}),
	),
}));

const mockCreate = vi.fn(() =>
	Promise.resolve({
		id: GOAL_ID,
		type: 'business',
		title: 'Close 3 deals',
		status: 'active',
	}),
);
const mockList = vi.fn(() =>
	Promise.resolve([
		{
			id: GOAL_ID,
			type: 'business',
			title: 'Close 3 deals',
			status: 'active',
		},
	]),
);
const mockProgress = vi.fn(() => Promise.resolve({ id: GOAL_ID, currentCount: 2 }));
const mockStatus = vi.fn(() => Promise.resolve({ id: GOAL_ID, status: 'paused' }));

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	createGoal: mockCreate,
	listGoals: mockList,
	updateGoalProgress: mockProgress,
	updateGoalStatus: mockStatus,
}));

describe('goals actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('createGoalAction trims input before calling the DAL', async () => {
		const { createGoalAction } = await import('@/app/actions/goals');
		const result = await createGoalAction({
			type: 'business',
			title: '  Close 3 deals  ',
			description: '  Warm intros  ',
			targetCount: 3,
			contactId: CONTACT_ID,
		});

		expect(result?.data).toBeDefined();
		expect(mockCreate).toHaveBeenCalledWith(
			WORKSPACE_ID,
			{
				type: 'business',
				title: 'Close 3 deals',
				description: 'Warm intros',
				targetCount: 3,
				contactId: CONTACT_ID,
				targetDate: undefined,
			},
			expect.any(Object),
		);
	});

	it('createGoalAction rejects blank titles after trimming', async () => {
		const { createGoalAction } = await import('@/app/actions/goals');
		const result = await createGoalAction({
			type: 'business',
			title: '   ',
			targetCount: 3,
		});

		expect(result?.validationErrors).toBeDefined();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('listGoalsAction calls DAL with filter options', async () => {
		const { listGoalsAction } = await import('@/app/actions/goals');
		const result = await listGoalsAction({ status: 'active', type: 'business' });

		expect(result?.data).toBeDefined();
		expect(mockList).toHaveBeenCalledWith(
			WORKSPACE_ID,
			{ status: 'active', type: 'business', sort: undefined, limit: undefined },
			expect.any(Object),
		);
	});

	it('updateGoalStatusAction pauses goal', async () => {
		const { updateGoalStatusAction } = await import('@/app/actions/goals');
		const result = await updateGoalStatusAction({ goalId: GOAL_ID, status: 'paused' });

		expect(result?.data).toBeDefined();
		expect(mockStatus).toHaveBeenCalledWith(WORKSPACE_ID, GOAL_ID, 'paused');
	});
});
