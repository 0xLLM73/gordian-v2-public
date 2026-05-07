import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateWatchlistPrice = vi.fn();
const mockWhere = vi.fn((): Promise<unknown[]> => Promise.resolve([]));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@repo/db', () => ({
	db: { select: mockSelect },
	tokenWatchlist: {
		workspaceId: 'workspaceId',
		symbol: 'symbol',
		coingeckoId: 'coingeckoId',
		status: 'status',
	},
	updateWatchlistPrice: mockUpdateWatchlistPrice,
	eq: vi.fn(),
}));

describe('token-price updater', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it('skips when no watched tokens', async () => {
		mockWhere.mockResolvedValue([]);

		const { updateTokenPrices } = await import('../token-price');
		await updateTokenPrices();

		expect(mockUpdateWatchlistPrice).not.toHaveBeenCalled();
	});

	it('fetches prices and updates watchlist', async () => {
		mockWhere.mockResolvedValue([{ workspaceId: 'ws-1', symbol: 'BTC', coingeckoId: 'bitcoin' }]);

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					bitcoin: { usd: 100000, usd_24h_change: 2.5, usd_market_cap: 2e12 },
				}),
		});
		vi.stubGlobal('fetch', mockFetch);

		const { updateTokenPrices } = await import('../token-price');
		await updateTokenPrices();

		expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('bitcoin'));
		expect(mockUpdateWatchlistPrice).toHaveBeenCalledWith('ws-1', 'BTC', {
			lastPrice: 100000,
			priceChange24h: 2.5,
			marketCap: 2e12,
		});

		vi.unstubAllGlobals();
	});

	it('handles CoinGecko API error', async () => {
		mockWhere.mockResolvedValue([{ workspaceId: 'ws-1', symbol: 'BTC', coingeckoId: 'bitcoin' }]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

		const { updateTokenPrices } = await import('../token-price');
		await updateTokenPrices();

		expect(mockUpdateWatchlistPrice).not.toHaveBeenCalled();

		vi.unstubAllGlobals();
	});

	it('skips tokens without usd price', async () => {
		mockWhere.mockResolvedValue([
			{ workspaceId: 'ws-1', symbol: 'BTC', coingeckoId: 'bitcoin' },
			{ workspaceId: 'ws-1', symbol: 'UNKNOWN', coingeckoId: 'unknown-token' },
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						bitcoin: { usd: 100000, usd_24h_change: 1.0, usd_market_cap: 2e12 },
						'unknown-token': {},
					}),
			}),
		);

		const { updateTokenPrices } = await import('../token-price');
		await updateTokenPrices();

		expect(mockUpdateWatchlistPrice).toHaveBeenCalledTimes(1);
		expect(mockUpdateWatchlistPrice).toHaveBeenCalledWith('ws-1', 'BTC', expect.any(Object));

		vi.unstubAllGlobals();
	});

	it('continues on individual update failure', async () => {
		mockWhere.mockResolvedValue([
			{ workspaceId: 'ws-1', symbol: 'BTC', coingeckoId: 'bitcoin' },
			{ workspaceId: 'ws-2', symbol: 'BTC', coingeckoId: 'bitcoin' },
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						bitcoin: { usd: 100000, usd_24h_change: 1.0, usd_market_cap: 2e12 },
					}),
			}),
		);

		mockUpdateWatchlistPrice
			.mockRejectedValueOnce(new Error('DB error'))
			.mockResolvedValueOnce(undefined);

		const { updateTokenPrices } = await import('../token-price');
		await updateTokenPrices();

		expect(mockUpdateWatchlistPrice).toHaveBeenCalledTimes(2);

		vi.unstubAllGlobals();
	});
});
