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

const mockGetWatchlist = vi.fn(() => Promise.resolve([{ symbol: 'BTC', lastPrice: '100000' }]));
const mockGetTopMentions = vi.fn(() => Promise.resolve([{ symbol: 'BTC', count: 5 }]));
const mockAddToWatchlist = vi.fn(() => Promise.resolve({ id: 'tw-1' }));
const mockRemoveFromWatchlist = vi.fn(() => Promise.resolve());

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	getWatchlist: mockGetWatchlist,
	getTopMentionedTokens: mockGetTopMentions,
	addToWatchlist: mockAddToWatchlist,
	removeFromWatchlist: mockRemoveFromWatchlist,
}));

describe('token actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('getWatchlistAction returns watchlist', async () => {
		const { getWatchlistAction } = await import('@/app/actions/tokens');
		const result = await getWatchlistAction({});
		expect(result?.data).toBeDefined();
		expect(mockGetWatchlist).toHaveBeenCalledWith(WORKSPACE_ID);
	});

	it('getTopMentionsAction defaults to limit 10', async () => {
		const { getTopMentionsAction } = await import('@/app/actions/tokens');
		await getTopMentionsAction({});
		expect(mockGetTopMentions).toHaveBeenCalledWith(WORKSPACE_ID, 10);
	});

	it('getTopMentionsAction accepts custom limit', async () => {
		const { getTopMentionsAction } = await import('@/app/actions/tokens');
		await getTopMentionsAction({ limit: 5 });
		expect(mockGetTopMentions).toHaveBeenCalledWith(WORKSPACE_ID, 5);
	});

	it('addToWatchlistAction adds token', async () => {
		const { addToWatchlistAction } = await import('@/app/actions/tokens');
		const result = await addToWatchlistAction({ symbol: 'BTC', name: 'Bitcoin' });
		expect(result?.data).toBeDefined();
		expect(mockAddToWatchlist).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({ symbol: 'BTC', name: 'Bitcoin' }),
		);
	});

	it('addToWatchlistAction rejects empty symbol', async () => {
		const { addToWatchlistAction } = await import('@/app/actions/tokens');
		const result = await addToWatchlistAction({ symbol: '' });
		expect(result?.validationErrors).toBeDefined();
	});

	it('removeFromWatchlistAction removes token', async () => {
		const { removeFromWatchlistAction } = await import('@/app/actions/tokens');
		await removeFromWatchlistAction({ symbol: 'BTC' });
		expect(mockRemoveFromWatchlist).toHaveBeenCalledWith(WORKSPACE_ID, 'BTC');
	});
});
