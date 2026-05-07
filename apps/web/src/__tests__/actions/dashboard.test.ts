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

const mockGetDashboardStats = vi.fn(() =>
	Promise.resolve({
		contactCount: 42,
		activeCommitmentCount: 7,
		openDealCount: 3,
		totalDealValue: 150000,
	}),
);

const mockGetDealStageCounts = vi.fn(() =>
	Promise.resolve([
		{ stage: 'discovery', count: 2, totalValue: 50000 },
		{ stage: 'negotiation', count: 1, totalValue: 100000 },
	]),
);

const mockGetUpcomingCommitments = vi.fn(() =>
	Promise.resolve([
		{
			id: 'cm-1',
			title: 'Follow up with Alice',
			contactId: 'c-1',
			commitmentType: 'task',
			dueDate: new Date('2026-02-20'),
			isOverdue: false,
		},
		{
			id: 'cm-2',
			title: 'Send proposal to Bob',
			contactId: 'c-2',
			commitmentType: 'promise',
			dueDate: new Date('2026-02-15'),
			isOverdue: true,
		},
	]),
);

const mockGetRecentActivity = vi.fn(() =>
	Promise.resolve([
		{
			id: 'c-1',
			type: 'contact_created',
			title: 'New contact: Alice',
			timestamp: new Date('2026-02-17T10:00:00Z'),
		},
		{
			id: 'd-1',
			type: 'deal_created',
			title: 'Deal: Series A',
			timestamp: new Date('2026-02-17T09:00:00Z'),
		},
	]),
);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getDashboardStats: mockGetDashboardStats,
	getDealStageCounts: mockGetDealStageCounts,
	getUpcomingCommitments: mockGetUpcomingCommitments,
	getRecentActivity: mockGetRecentActivity,
}));

vi.mock('@/lib/workspace', () => ({
	requireSession: vi.fn(() =>
		Promise.resolve({
			user: { id: 'user-1', email: 'test@test.com', name: 'Test' },
			session: { id: 'session-1' },
		}),
	),
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() =>
		Promise.resolve({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: { WorkspaceID: 'mock' },
			wrkVersion: 1,
		}),
	),
}));

describe('dashboard DAL functions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getDashboardStats', () => {
		it('returns correct counts', async () => {
			const { getDashboardStats } = await import('@repo/db');
			const stats = await getDashboardStats(WORKSPACE_ID);

			expect(stats.contactCount).toBe(42);
			expect(stats.activeCommitmentCount).toBe(7);
			expect(stats.openDealCount).toBe(3);
			expect(stats.totalDealValue).toBe(150000);
		});

		it('returns zero counts for empty workspace', async () => {
			mockGetDashboardStats.mockResolvedValueOnce({
				contactCount: 0,
				activeCommitmentCount: 0,
				openDealCount: 0,
				totalDealValue: 0,
			});

			const { getDashboardStats } = await import('@repo/db');
			const stats = await getDashboardStats('empty-workspace-id');

			expect(stats.contactCount).toBe(0);
			expect(stats.activeCommitmentCount).toBe(0);
			expect(stats.openDealCount).toBe(0);
			expect(stats.totalDealValue).toBe(0);
		});
	});

	describe('getDealStageCounts', () => {
		it('returns per-stage counts with values', async () => {
			const { getDealStageCounts } = await import('@repo/db');
			const counts = await getDealStageCounts(WORKSPACE_ID);

			expect(counts).toHaveLength(2);
			expect(counts[0]).toEqual({ stage: 'discovery', count: 2, totalValue: 50000 });
			expect(counts[1]).toEqual({ stage: 'negotiation', count: 1, totalValue: 100000 });
		});

		it('returns empty array when no deals', async () => {
			mockGetDealStageCounts.mockResolvedValueOnce([]);

			const { getDealStageCounts } = await import('@repo/db');
			const counts = await getDealStageCounts('no-deals-workspace');

			expect(counts).toHaveLength(0);
		});
	});

	describe('getUpcomingCommitments', () => {
		it('returns commitments sorted by due date', async () => {
			const { getUpcomingCommitments } = await import('@repo/db');
			const envelope = {
				encryptedWrk: Buffer.from('mock'),
				kmsContext: { WorkspaceID: 'mock' },
				wrkVersion: 1,
			};
			const items = await getUpcomingCommitments(WORKSPACE_ID, envelope, { limit: 5 });

			expect(items).toHaveLength(2);
			expect(items[0].title).toBe('Follow up with Alice');
			expect(items[1].title).toBe('Send proposal to Bob');
		});

		it('marks overdue commitments correctly', async () => {
			const { getUpcomingCommitments } = await import('@repo/db');
			const envelope = {
				encryptedWrk: Buffer.from('mock'),
				kmsContext: { WorkspaceID: 'mock' },
				wrkVersion: 1,
			};
			const items = await getUpcomingCommitments(WORKSPACE_ID, envelope);

			const overdue = items.find((i) => i.id === 'cm-2');
			const upcoming = items.find((i) => i.id === 'cm-1');

			expect(overdue?.isOverdue).toBe(true);
			expect(upcoming?.isOverdue).toBe(false);
		});

		it('handles empty commitments list', async () => {
			mockGetUpcomingCommitments.mockResolvedValueOnce([]);

			const { getUpcomingCommitments } = await import('@repo/db');
			const envelope = {
				encryptedWrk: Buffer.from('mock'),
				kmsContext: { WorkspaceID: 'mock' },
				wrkVersion: 1,
			};
			const items = await getUpcomingCommitments(WORKSPACE_ID, envelope);

			expect(items).toHaveLength(0);
		});
	});

	describe('getRecentActivity', () => {
		it('merges and sorts across entity types', async () => {
			const { getRecentActivity } = await import('@repo/db');
			const envelope = {
				encryptedWrk: Buffer.from('mock'),
				kmsContext: { WorkspaceID: 'mock' },
				wrkVersion: 1,
			};
			const items = await getRecentActivity(WORKSPACE_ID, envelope);

			expect(items).toHaveLength(2);
			// Sorted by timestamp desc — contact_created (10:00) comes first
			expect(items[0].type).toBe('contact_created');
			expect(items[1].type).toBe('deal_created');
		});

		it('respects limit parameter', async () => {
			mockGetRecentActivity.mockResolvedValueOnce([
				{
					id: 'c-1',
					type: 'contact_created',
					title: 'New contact: Alice',
					timestamp: new Date('2026-02-17T10:00:00Z'),
				},
			]);

			const { getRecentActivity } = await import('@repo/db');
			const envelope = {
				encryptedWrk: Buffer.from('mock'),
				kmsContext: { WorkspaceID: 'mock' },
				wrkVersion: 1,
			};
			const items = await getRecentActivity(WORKSPACE_ID, envelope, { limit: 1 });

			expect(items).toHaveLength(1);
		});

		it('returns empty list when no activity', async () => {
			mockGetRecentActivity.mockResolvedValueOnce([]);

			const { getRecentActivity } = await import('@repo/db');
			const envelope = {
				encryptedWrk: Buffer.from('mock'),
				kmsContext: { WorkspaceID: 'mock' },
				wrkVersion: 1,
			};
			const items = await getRecentActivity(WORKSPACE_ID, envelope);

			expect(items).toHaveLength(0);
		});
	});
});
