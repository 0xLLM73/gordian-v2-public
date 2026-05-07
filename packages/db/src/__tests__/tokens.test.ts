import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReturning = vi.fn<any>();
const mockOnConflictDoNothing = vi.fn<any>(() => ({ returning: mockReturning }));
const mockValues = vi.fn<any>(() => ({
	returning: mockReturning,
	onConflictDoNothing: mockOnConflictDoNothing,
}));
const mockInsert = vi.fn<any>(() => ({ values: mockValues }));
const mockLimit = vi.fn<any>(() => Promise.resolve([]));
const mockOrderBy = vi.fn<any>(() => ({ limit: mockLimit }));
const mockGroupBy = vi.fn<any>(() => ({ orderBy: mockOrderBy }));
const mockWhere = vi.fn<any>(() => ({
	groupBy: mockGroupBy,
	orderBy: mockOrderBy,
	limit: mockLimit,
}));
const mockFrom = vi.fn<any>(() => ({ where: mockWhere }));
const mockSelect = vi.fn<any>(() => ({ from: mockFrom }));
const mockSetWhere = vi.fn<any>(() => Promise.resolve([]));
const mockSet = vi.fn<any>(() => ({ where: mockSetWhere }));
const mockUpdate = vi.fn<any>(() => ({ set: mockSet }));

vi.mock('../client', () => ({
	db: {
		insert: mockInsert,
		update: mockUpdate,
		select: mockSelect,
	},
}));

describe('tokens DAL', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('createTokenMention inserts with uppercase symbol', async () => {
		mockReturning.mockResolvedValue([{ id: 'tm-1' }]);

		const { createTokenMention } = await import('../dal/tokens');
		const result = await createTokenMention('ws-1', {
			symbol: 'btc',
			name: 'Bitcoin',
			contactId: 'c-1',
			confidence: 0.95,
		});

		expect(mockInsert).toHaveBeenCalled();
		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceId: 'ws-1',
				symbol: 'BTC',
				name: 'Bitcoin',
				contactId: 'c-1',
			}),
		);
		expect(result).toEqual({ id: 'tm-1' });
	});

	it('getTopMentionedTokens applies workspace filter and limit', async () => {
		mockLimit.mockResolvedValue([
			{ symbol: 'BTC', name: 'Bitcoin', count: 5, latestMention: '2026-01-01' },
		]);

		const { getTopMentionedTokens } = await import('../dal/tokens');
		const result = await getTopMentionedTokens('ws-1', 5);

		expect(mockSelect).toHaveBeenCalled();
		expect(mockFrom).toHaveBeenCalled();
		expect(mockWhere).toHaveBeenCalled();
		expect(result).toHaveLength(1);
	});

	it('getTopMentionedTokens defaults to limit 10', async () => {
		mockLimit.mockResolvedValue([]);

		const { getTopMentionedTokens } = await import('../dal/tokens');
		await getTopMentionedTokens('ws-1');

		expect(mockLimit).toHaveBeenCalledWith(10);
	});

	it('addToWatchlist uses onConflictDoNothing', async () => {
		mockReturning.mockResolvedValue([{ id: 'tw-1' }]);

		const { addToWatchlist } = await import('../dal/tokens');
		const result = await addToWatchlist('ws-1', { symbol: 'eth', name: 'Ethereum' });

		expect(mockInsert).toHaveBeenCalled();
		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: 'ws-1', symbol: 'ETH' }),
		);
		expect(mockOnConflictDoNothing).toHaveBeenCalled();
		expect(result).toEqual({ id: 'tw-1' });
	});

	it('updateWatchlistPrice updates with correct price data', async () => {
		const { updateWatchlistPrice } = await import('../dal/tokens');
		await updateWatchlistPrice('ws-1', 'btc', {
			lastPrice: 100000,
			priceChange24h: 2.5,
			marketCap: 2000000000000,
		});

		expect(mockUpdate).toHaveBeenCalled();
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({
				lastPrice: '100000',
				priceChange24h: '2.5',
				marketCap: '2000000000000',
			}),
		);
	});

	it('removeFromWatchlist sets status to archived', async () => {
		const { removeFromWatchlist } = await import('../dal/tokens');
		await removeFromWatchlist('ws-1', 'btc');

		expect(mockUpdate).toHaveBeenCalled();
		expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }));
	});

	it('incrementMentionCount uses SQL increment', async () => {
		const { incrementMentionCount } = await import('../dal/tokens');
		await incrementMentionCount('ws-1', 'btc');

		expect(mockUpdate).toHaveBeenCalled();
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ mentionCount: expect.anything() }),
		);
	});

	it('getTokenMentionsByContact filters by workspace and contact', async () => {
		mockLimit.mockResolvedValue([]);

		const { getTokenMentionsByContact } = await import('../dal/tokens');
		await getTokenMentionsByContact('ws-1', 'c-1');

		expect(mockSelect).toHaveBeenCalled();
		expect(mockFrom).toHaveBeenCalled();
		expect(mockWhere).toHaveBeenCalled();
	});
});
