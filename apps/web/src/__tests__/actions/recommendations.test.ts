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
const MOCK_ENVELOPE = {
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: 'mock' },
	wrkVersion: 1,
};

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(MOCK_ENVELOPE)),
}));

const mockGetPendingRecommendations = vi.fn();
const mockActOnRecommendation = vi.fn();
const mockDismissRecommendation = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getPendingRecommendations: mockGetPendingRecommendations,
	actOnRecommendation: mockActOnRecommendation,
	dismissRecommendation: mockDismissRecommendation,
}));

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

const mockRec = {
	id: VALID_UUID,
	workspaceId: WORKSPACE_ID,
	contactId: null,
	type: 'follow_up',
	priorityScore: 0.8,
	reasoning: 'You have not spoken to this contact in 30 days.',
	status: 'pending',
	expiresAt: null,
	createdAt: new Date(),
};

describe('recommendation actions', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	describe('getPendingRecommendationsAction', () => {
		it('returns top 3 pending recommendations for the workspace', async () => {
			mockGetPendingRecommendations.mockResolvedValue([mockRec]);

			const { getPendingRecommendationsAction } = await import('@/app/actions/recommendations');
			const result = await getPendingRecommendationsAction();

			expect(result?.data).toEqual([mockRec]);
			expect(mockGetPendingRecommendations).toHaveBeenCalledWith(WORKSPACE_ID, 3);
		});

		it('returns empty array when no pending recommendations exist', async () => {
			mockGetPendingRecommendations.mockResolvedValue([]);

			const { getPendingRecommendationsAction } = await import('@/app/actions/recommendations');
			const result = await getPendingRecommendationsAction();

			expect(result?.data).toEqual([]);
			expect(mockGetPendingRecommendations).toHaveBeenCalledWith(WORKSPACE_ID, 3);
		});
	});

	describe('actOnRecommendationAction', () => {
		it('marks recommendation as acted and returns updated record', async () => {
			const actedRec = { ...mockRec, status: 'acted' };
			mockActOnRecommendation.mockResolvedValue(actedRec);

			const { actOnRecommendationAction } = await import('@/app/actions/recommendations');
			const result = await actOnRecommendationAction({ id: VALID_UUID });

			expect(result?.data).toEqual(actedRec);
			// workspaceId MUST be passed — prevents acting on another workspace's recommendation
			expect(mockActOnRecommendation).toHaveBeenCalledWith(VALID_UUID, WORKSPACE_ID);
		});

		it('rejects invalid UUID', async () => {
			const { actOnRecommendationAction } = await import('@/app/actions/recommendations');
			const result = await actOnRecommendationAction({ id: 'not-a-uuid' });

			expect(result?.validationErrors).toBeDefined();
			expect(mockActOnRecommendation).not.toHaveBeenCalled();
		});
	});

	describe('dismissRecommendationAction', () => {
		it('marks recommendation as dismissed and returns updated record', async () => {
			const dismissedRec = { ...mockRec, status: 'dismissed' };
			mockDismissRecommendation.mockResolvedValue(dismissedRec);

			const { dismissRecommendationAction } = await import('@/app/actions/recommendations');
			const result = await dismissRecommendationAction({ id: VALID_UUID });

			expect(result?.data).toEqual(dismissedRec);
			// workspaceId MUST be passed — prevents dismissing another workspace's recommendation
			expect(mockDismissRecommendation).toHaveBeenCalledWith(VALID_UUID, WORKSPACE_ID);
		});

		it('rejects invalid UUID', async () => {
			const { dismissRecommendationAction } = await import('@/app/actions/recommendations');
			const result = await dismissRecommendationAction({ id: 'not-a-uuid' });

			expect(result?.validationErrors).toBeDefined();
			expect(mockDismissRecommendation).not.toHaveBeenCalled();
		});

		it('returns null when recommendation not found (already acted or expired)', async () => {
			mockDismissRecommendation.mockResolvedValue(null);

			const { dismissRecommendationAction } = await import('@/app/actions/recommendations');
			const result = await dismissRecommendationAction({ id: VALID_UUID });

			expect(result?.data).toBeNull();
			expect(mockDismissRecommendation).toHaveBeenCalledWith(VALID_UUID, WORKSPACE_ID);
		});
	});
});
