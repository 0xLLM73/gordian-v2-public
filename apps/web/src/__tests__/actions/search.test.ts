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

const mockUnifiedSearch = vi.fn(() =>
	Promise.resolve({
		contacts: [{ id: 'c1', firstName: 'John' }] as Array<Record<string, unknown>>,
		memories: [] as Array<{ id: string; content: string; category: string; rrf_score: number }>,
		commitments: [{ id: 'cm1', title: 'Follow up with John' }] as Array<Record<string, unknown>>,
		deals: [] as Array<Record<string, unknown>>,
	}),
);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	unifiedSearch: mockUnifiedSearch,
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

describe('search actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('searchAction', () => {
		it('calls unifiedSearch with correct params', async () => {
			const { searchAction } = await import('@/app/actions/search');
			const result = await searchAction({
				query: 'John',
			});
			expect(result?.data).toBeDefined();
			expect(result?.data?.contacts).toHaveLength(1);
			expect(result?.data?.commitments).toHaveLength(1);
			expect(mockUnifiedSearch).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'John',
				expect.any(Object),
				null, // short query = no embedding
			);
		});

		it('returns empty results when nothing matches', async () => {
			mockUnifiedSearch.mockResolvedValueOnce({
				contacts: [],
				memories: [],
				commitments: [],
				deals: [],
			});

			const { searchAction } = await import('@/app/actions/search');
			const result = await searchAction({
				query: 'nonexistent',
			});
			expect(result?.data?.contacts).toHaveLength(0);
			expect(result?.data?.memories).toHaveLength(0);
			expect(result?.data?.deals).toHaveLength(0);
		});

		it('rejects empty query', async () => {
			const { searchAction } = await import('@/app/actions/search');
			const result = await searchAction({
				query: '',
			});
			expect(result?.validationErrors).toBeDefined();
		});

		it('searches across all entity types', async () => {
			mockUnifiedSearch.mockResolvedValueOnce({
				contacts: [{ id: 'c1', firstName: 'Alice' }],
				memories: [
					{ id: 'm1', content: 'meeting notes', category: 'conversation', rrf_score: 0.8 },
				],
				commitments: [{ id: 'cm1', title: 'Review meeting notes' }],
				deals: [{ id: 'd1' }],
			});

			const { searchAction } = await import('@/app/actions/search');
			const result = await searchAction({
				query: 'meeting notes about project',
			});
			expect(result?.data?.contacts).toHaveLength(1);
			expect(result?.data?.memories).toHaveLength(1);
			expect(result?.data?.commitments).toHaveLength(1);
			expect(result?.data?.deals).toHaveLength(1);
		});
	});
});
