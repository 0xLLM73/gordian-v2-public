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
const CONTACT_UUID = '123e4567-e89b-12d3-a456-426614174000';
const MOCK_ENVELOPE = {
	encryptedWrk: Buffer.from('mock'),
	kmsContext: { WorkspaceID: 'mock' },
	wrkVersion: 1,
};

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() => Promise.resolve(MOCK_ENVELOPE)),
}));

const mockGetInvestorProfile = vi.fn();
const mockGetTopInvestors = vi.fn();

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getInvestorProfile: mockGetInvestorProfile,
	getTopInvestors: mockGetTopInvestors,
}));

const mockProfile = {
	id: 'profile-1',
	workspaceId: WORKSPACE_ID,
	contactId: CONTACT_UUID,
	dealCount: 5,
	winRate: 0.6,
	avgCycleDays: 45,
	preferredRole: 'lead',
	sectorFocus: ['DeFi', 'Infrastructure'],
	ticketMin: 100000,
	ticketMax: 1000000,
	tokenInterests: ['ETH', 'SOL'],
	activityTrend: 'heating_up' as const,
	computedAt: new Date(),
	createdAt: new Date(),
};

describe('investor profile actions', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	describe('getInvestorProfileAction', () => {
		it('returns investor profile scoped to workspace', async () => {
			mockGetInvestorProfile.mockResolvedValue(mockProfile);

			const { getInvestorProfileAction } = await import('@/app/actions/investor-profiles');
			const result = await getInvestorProfileAction({ contactId: CONTACT_UUID });

			expect(result?.data).toEqual(mockProfile);
			// workspaceId MUST be passed — prevents cross-workspace profile reads
			expect(mockGetInvestorProfile).toHaveBeenCalledWith(WORKSPACE_ID, CONTACT_UUID);
		});

		it('returns null when contact has no investor profile', async () => {
			mockGetInvestorProfile.mockResolvedValue(null);

			const { getInvestorProfileAction } = await import('@/app/actions/investor-profiles');
			const result = await getInvestorProfileAction({ contactId: CONTACT_UUID });

			expect(result?.data).toBeNull();
			expect(mockGetInvestorProfile).toHaveBeenCalledWith(WORKSPACE_ID, CONTACT_UUID);
		});

		it('rejects invalid UUID for contactId', async () => {
			const { getInvestorProfileAction } = await import('@/app/actions/investor-profiles');
			const result = await getInvestorProfileAction({ contactId: 'not-a-uuid' });

			expect(result?.validationErrors).toBeDefined();
			expect(mockGetInvestorProfile).not.toHaveBeenCalled();
		});
	});

	describe('getTopInvestorsAction', () => {
		it('returns top investors ranked by win rate for the workspace', async () => {
			mockGetTopInvestors.mockResolvedValue([mockProfile]);

			const { getTopInvestorsAction } = await import('@/app/actions/investor-profiles');
			const result = await getTopInvestorsAction({ limit: 5 });

			expect(result?.data).toEqual([mockProfile]);
			expect(mockGetTopInvestors).toHaveBeenCalledWith(WORKSPACE_ID, 5);
		});

		it('returns empty array when no investor profiles exist', async () => {
			mockGetTopInvestors.mockResolvedValue([]);

			const { getTopInvestorsAction } = await import('@/app/actions/investor-profiles');
			const result = await getTopInvestorsAction({ limit: 5 });

			expect(result?.data).toEqual([]);
			expect(mockGetTopInvestors).toHaveBeenCalledWith(WORKSPACE_ID, 5);
		});

		it('rejects limit exceeding max', async () => {
			const { getTopInvestorsAction } = await import('@/app/actions/investor-profiles');
			const result = await getTopInvestorsAction({ limit: 100 });

			expect(result?.validationErrors).toBeDefined();
			expect(mockGetTopInvestors).not.toHaveBeenCalled();
		});
	});
});
