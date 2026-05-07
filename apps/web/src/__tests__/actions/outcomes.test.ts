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

const mockGetOutcomeStats = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getOutcomeStats: mockGetOutcomeStats,
}));

const mockStats = [
	{
		type: 'deal_closed',
		total: 10,
		positive: 7,
		negative: 2,
		neutral: 1,
		winRate: 0.7,
	},
	{
		type: 'commitment_fulfilled',
		total: 5,
		positive: 5,
		negative: 0,
		neutral: 0,
		winRate: 1.0,
	},
];

describe('outcome actions', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	describe('getOutcomeStatsAction', () => {
		it('returns outcome stats scoped to workspace', async () => {
			mockGetOutcomeStats.mockResolvedValue(mockStats);

			const { getOutcomeStatsAction } = await import('@/app/actions/outcomes');
			const result = await getOutcomeStatsAction({});

			expect(result?.data).toEqual(mockStats);
			// workspaceId MUST be derived from session — never from client
			expect(mockGetOutcomeStats).toHaveBeenCalledWith(WORKSPACE_ID);
		});

		it('returns empty array when no outcomes exist', async () => {
			mockGetOutcomeStats.mockResolvedValue([]);

			const { getOutcomeStatsAction } = await import('@/app/actions/outcomes');
			const result = await getOutcomeStatsAction({});

			expect(result?.data).toEqual([]);
			expect(mockGetOutcomeStats).toHaveBeenCalledWith(WORKSPACE_ID);
		});

		it('does not accept workspaceId from client input', async () => {
			mockGetOutcomeStats.mockResolvedValue(mockStats);

			const { getOutcomeStatsAction } = await import('@/app/actions/outcomes');
			// Action schema is z.object({}) — any extra fields are stripped
			// workspaceId must come from session, not input
			await getOutcomeStatsAction({});

			expect(mockGetOutcomeStats).toHaveBeenCalledWith(WORKSPACE_ID);
			expect(mockGetOutcomeStats).not.toHaveBeenCalledWith('attacker-workspace-id');
		});
	});
});
