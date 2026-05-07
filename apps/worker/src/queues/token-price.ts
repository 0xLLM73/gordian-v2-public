import { db, eq, tokenWatchlist, updateWatchlistPrice } from '@repo/db';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const PRICE_UPDATE_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours

/**
 * CoinGecko price updater — runs on setInterval (no BullMQ repeat for DragonflyDB compat).
 * Fetches current prices for all watched tokens and updates the watchlist.
 */
export async function updateTokenPrices(): Promise<void> {
	try {
		// Get all unique coingecko IDs across all workspaces
		const watchedTokens = await db
			.select({
				workspaceId: tokenWatchlist.workspaceId,
				symbol: tokenWatchlist.symbol,
				coingeckoId: tokenWatchlist.coingeckoId,
			})
			.from(tokenWatchlist)
			.where(eq(tokenWatchlist.status, 'watching'));

		if (watchedTokens.length === 0) return;

		// Collect unique CoinGecko IDs
		const idMap = new Map<string, { workspaceId: string; symbol: string }[]>();
		for (const t of watchedTokens) {
			const cgId = t.coingeckoId ?? t.symbol.toLowerCase();
			const entries = idMap.get(cgId) ?? [];
			entries.push({ workspaceId: t.workspaceId, symbol: t.symbol });
			idMap.set(cgId, entries);
		}

		const ids = [...idMap.keys()].join(',');

		// Fetch prices from CoinGecko (free tier: 30 calls/min)
		const url = `${COINGECKO_API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
		const res = await fetch(url);

		if (!res.ok) {
			console.error(`[token-price] CoinGecko API error: ${res.status}`);
			return;
		}

		const data = (await res.json()) as Record<
			string,
			{ usd?: number; usd_24h_change?: number; usd_market_cap?: number }
		>;

		// Update prices per workspace
		for (const [cgId, priceInfo] of Object.entries(data)) {
			if (!priceInfo.usd) continue;

			const targets = idMap.get(cgId) ?? [];
			for (const target of targets) {
				try {
					await updateWatchlistPrice(target.workspaceId, target.symbol, {
						lastPrice: priceInfo.usd,
						priceChange24h: priceInfo.usd_24h_change ?? 0,
						marketCap: priceInfo.usd_market_cap ?? 0,
					});
				} catch (err) {
					console.error(`[token-price] Failed to update ${target.symbol}:`, (err as Error).message);
				}
			}
		}

		console.log(`[token-price] Updated prices for ${Object.keys(data).length} tokens`);
	} catch (err) {
		console.error('[token-price] Price update failed:', (err as Error).message);
	}
}

let tokenPriceInterval: ReturnType<typeof setInterval> | null = null;

/** Schedule periodic price updates — DragonflyDB-safe (no BullMQ repeat) */
export function scheduleTokenPriceUpdates(): void {
	// Initial update after 30 seconds
	setTimeout(() => {
		updateTokenPrices().catch((err) =>
			console.error('[token-price] Initial update failed:', err.message),
		);
	}, 30_000);

	// Then every 2 hours
	tokenPriceInterval = setInterval(() => {
		updateTokenPrices().catch((err) =>
			console.error('[token-price] Periodic update failed:', err.message),
		);
	}, PRICE_UPDATE_INTERVAL);

	console.log('[token-price] Scheduled price updates every 2 hours');
}

/** Stop the token price update interval for graceful shutdown */
export function stopTokenPriceUpdates(): void {
	if (tokenPriceInterval) {
		clearInterval(tokenPriceInterval);
		tokenPriceInterval = null;
	}
}
