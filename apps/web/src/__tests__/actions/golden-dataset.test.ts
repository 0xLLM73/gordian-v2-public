import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPromoteToGold = vi.fn();
const mockRejectExample = vi.fn();
const mockCreateCorrectionDiff = vi.fn();
const mockListPendingExamples = vi.fn();
const mockGetReviewQueueStats = vi.fn();
const mockWorkspaceLimit = vi.fn();

type MockWorkspaceAction = (input: {
	parsedInput: Record<string, unknown>;
	ctx: { session: { user: { id: string } }; workspaceId: string };
}) => Promise<unknown>;

vi.mock('@repo/db', () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: mockWorkspaceLimit,
				})),
			})),
		})),
	},
	eq: vi.fn(),
	workspaces: { id: 'id', ownerId: 'owner_id' },
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	promoteToGold: (...args: unknown[]) => mockPromoteToGold(...args),
	rejectExample: (...args: unknown[]) => mockRejectExample(...args),
	createCorrectionDiff: (...args: unknown[]) => mockCreateCorrectionDiff(...args),
	listPendingExamples: (...args: unknown[]) => mockListPendingExamples(...args),
	getReviewQueueStats: (...args: unknown[]) => mockGetReviewQueueStats(...args),
}));

vi.mock('@/lib/safe-action', () => ({
	workspaceAction: {
		schema: () => ({
			action: (fn: (...args: unknown[]) => unknown) => fn,
		}),
	},
}));

describe('classifyDiffType', () => {
	// We test classifyDiffType indirectly through promoteToGoldAction behavior

	beforeEach(() => {
		vi.clearAllMocks();
		mockWorkspaceLimit.mockReturnValue([{ ownerId: 'user-1' }]);
		mockCreateCorrectionDiff.mockResolvedValue(undefined);
	});

	it('promoteToGoldAction creates diff when prediction differs from corrected output', async () => {
		mockPromoteToGold.mockResolvedValue({
			id: 'golden-1',
			modelPrediction: { title: 'Call Bob', commitment_type: 'task', assignee: 'user' },
			correctedOutput: { title: 'Email Bob', commitment_type: 'task', assignee: 'user' },
		});

		// Import the action module to get the actual function
		const { promoteToGoldAction } = await import('@/app/actions/golden-dataset');

		// Since we're mocking safe-action, promoteToGoldAction is the raw handler
		await (promoteToGoldAction as unknown as MockWorkspaceAction)({
			parsedInput: { goldenId: 'golden-1', verificationScore: 0.9 },
			ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
		});

		expect(mockPromoteToGold).toHaveBeenCalledWith('golden-1', 'user-1', 0.9, 'ws-1');
		expect(mockCreateCorrectionDiff).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 'ws-1',
				goldenId: 'golden-1',
				severityScore: 5,
			}),
		);
	});

	it('rejects learning actions for non-owner workspace members', async () => {
		mockWorkspaceLimit.mockReturnValue([{ ownerId: 'owner-2' }]);

		const { listPendingExamplesAction } = await import('@/app/actions/golden-dataset');

		await expect(
			(listPendingExamplesAction as unknown as MockWorkspaceAction)({
				parsedInput: { limit: 20, offset: 0 },
				ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
			}),
		).rejects.toThrow('Unauthorized');
		expect(mockListPendingExamples).not.toHaveBeenCalled();
	});

	it('promoteToGoldAction skips diff when prediction matches corrected output', async () => {
		const same = { title: 'Call Bob', commitment_type: 'task', assignee: 'user' };
		mockPromoteToGold.mockResolvedValue({
			id: 'golden-2',
			modelPrediction: same,
			correctedOutput: same,
		});

		const { promoteToGoldAction } = await import('@/app/actions/golden-dataset');

		await (promoteToGoldAction as unknown as MockWorkspaceAction)({
			parsedInput: { goldenId: 'golden-2' },
			ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
		});

		expect(mockCreateCorrectionDiff).not.toHaveBeenCalled();
	});

	it('promoteToGoldAction skips diff when modelPrediction is null', async () => {
		mockPromoteToGold.mockResolvedValue({
			id: 'golden-3',
			modelPrediction: null,
			correctedOutput: { title: 'Some commitment' },
		});

		const { promoteToGoldAction } = await import('@/app/actions/golden-dataset');

		await (promoteToGoldAction as unknown as MockWorkspaceAction)({
			parsedInput: { goldenId: 'golden-3' },
			ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
		});

		expect(mockCreateCorrectionDiff).not.toHaveBeenCalled();
	});

	it('rejectExampleAction always creates a correction diff', async () => {
		mockRejectExample.mockResolvedValue({
			id: 'golden-4',
			modelPrediction: { title: 'Not a real commitment', commitment_type: 'task' },
		});

		const { rejectExampleAction } = await import('@/app/actions/golden-dataset');

		await (rejectExampleAction as unknown as MockWorkspaceAction)({
			parsedInput: { goldenId: 'golden-4' },
			ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
		});

		expect(mockRejectExample).toHaveBeenCalledWith('golden-4', 'user-1', 'ws-1');
		expect(mockCreateCorrectionDiff).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 'ws-1',
				goldenId: 'golden-4',
				diffType: 'false_positive',
				severityScore: 7,
			}),
		);
	});

	it('rejectExampleAction skips diff when rejectExample returns null', async () => {
		mockRejectExample.mockResolvedValue(null);

		const { rejectExampleAction } = await import('@/app/actions/golden-dataset');

		await (rejectExampleAction as unknown as MockWorkspaceAction)({
			parsedInput: { goldenId: 'golden-5' },
			ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
		});

		expect(mockCreateCorrectionDiff).not.toHaveBeenCalled();
	});

	it('promoteToGoldAction catches diff creation errors gracefully', async () => {
		mockPromoteToGold.mockResolvedValue({
			id: 'golden-6',
			modelPrediction: { title: 'A' },
			correctedOutput: { title: 'B' },
		});
		mockCreateCorrectionDiff.mockRejectedValue(new Error('DB down'));

		const { promoteToGoldAction } = await import('@/app/actions/golden-dataset');

		// Should not throw despite diff creation failure
		await expect(
			(promoteToGoldAction as unknown as MockWorkspaceAction)({
				parsedInput: { goldenId: 'golden-6' },
				ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
			}),
		).resolves.not.toThrow();
	});

	it('classifies wrong_type when commitment_type differs', async () => {
		mockPromoteToGold.mockResolvedValue({
			id: 'golden-7',
			modelPrediction: { title: 'A', commitment_type: 'task', assignee: 'user', due_date: null },
			correctedOutput: { title: 'A', commitment_type: 'meeting', assignee: 'user', due_date: null },
		});

		const { promoteToGoldAction } = await import('@/app/actions/golden-dataset');

		await (promoteToGoldAction as unknown as MockWorkspaceAction)({
			parsedInput: { goldenId: 'golden-7' },
			ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
		});

		expect(mockCreateCorrectionDiff).toHaveBeenCalledWith(
			expect.objectContaining({ diffType: 'wrong_type' }),
		);
	});

	it('classifies wrong_entity when assignee differs', async () => {
		mockPromoteToGold.mockResolvedValue({
			id: 'golden-8',
			modelPrediction: { title: 'A', commitment_type: 'task', assignee: 'user' },
			correctedOutput: { title: 'A', commitment_type: 'task', assignee: 'contact' },
		});

		const { promoteToGoldAction } = await import('@/app/actions/golden-dataset');

		await (promoteToGoldAction as unknown as MockWorkspaceAction)({
			parsedInput: { goldenId: 'golden-8' },
			ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
		});

		expect(mockCreateCorrectionDiff).toHaveBeenCalledWith(
			expect.objectContaining({ diffType: 'wrong_entity' }),
		);
	});

	it('classifies wrong_date when due_date differs', async () => {
		mockPromoteToGold.mockResolvedValue({
			id: 'golden-9',
			modelPrediction: {
				title: 'A',
				commitment_type: 'task',
				assignee: 'user',
				due_date: '2026-03-01',
			},
			correctedOutput: {
				title: 'A',
				commitment_type: 'task',
				assignee: 'user',
				due_date: '2026-04-01',
			},
		});

		const { promoteToGoldAction } = await import('@/app/actions/golden-dataset');

		await (promoteToGoldAction as unknown as MockWorkspaceAction)({
			parsedInput: { goldenId: 'golden-9' },
			ctx: { session: { user: { id: 'user-1' } }, workspaceId: 'ws-1' },
		});

		expect(mockCreateCorrectionDiff).toHaveBeenCalledWith(
			expect.objectContaining({ diffType: 'wrong_date' }),
		);
	});
});
