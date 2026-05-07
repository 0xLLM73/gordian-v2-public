import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { tokenMentions, tokenWatchlist } from '../schema/tokens';

// ─── Token Mentions ────────────────────────────────────────────────────────

export interface CreateTokenMentionInput {
	contactId?: string;
	symbol: string;
	name?: string;
	context?: string;
	confidence?: number;
}

export async function createTokenMention(workspaceId: string, input: CreateTokenMentionInput) {
	const [result] = await db
		.insert(tokenMentions)
		.values({
			workspaceId,
			contactId: input.contactId,
			symbol: input.symbol.toUpperCase(),
			name: input.name,
			context: input.context,
			confidence: input.confidence?.toString(),
		})
		.returning({ id: tokenMentions.id });
	return result;
}

export async function getTopMentionedTokens(workspaceId: string, limit = 10) {
	return db
		.select({
			symbol: tokenMentions.symbol,
			name: tokenMentions.name,
			count: sql<number>`count(*)::int`,
			latestMention: sql<string>`max(${tokenMentions.mentionedAt})`,
		})
		.from(tokenMentions)
		.where(eq(tokenMentions.workspaceId, workspaceId))
		.groupBy(tokenMentions.symbol, tokenMentions.name)
		.orderBy(sql`count(*) desc`)
		.limit(limit);
}

export async function getTokenMentionsByContact(
	workspaceId: string,
	contactId: string,
	limit = 20,
) {
	return db
		.select()
		.from(tokenMentions)
		.where(and(eq(tokenMentions.workspaceId, workspaceId), eq(tokenMentions.contactId, contactId)))
		.orderBy(desc(tokenMentions.mentionedAt))
		.limit(limit);
}

// ─── Token Watchlist ───────────────────────────────────────────────────────

export async function addToWatchlist(
	workspaceId: string,
	input: { symbol: string; name?: string; coingeckoId?: string },
) {
	const [result] = await db
		.insert(tokenWatchlist)
		.values({
			workspaceId,
			symbol: input.symbol.toUpperCase(),
			name: input.name,
			coingeckoId: input.coingeckoId,
		})
		.onConflictDoNothing()
		.returning({ id: tokenWatchlist.id });
	return result;
}

export async function getWatchlist(workspaceId: string) {
	return db
		.select()
		.from(tokenWatchlist)
		.where(and(eq(tokenWatchlist.workspaceId, workspaceId), eq(tokenWatchlist.status, 'watching')))
		.orderBy(desc(tokenWatchlist.mentionCount));
}

export async function updateWatchlistPrice(
	workspaceId: string,
	symbol: string,
	priceData: {
		lastPrice: number;
		priceChange24h: number;
		marketCap: number;
	},
) {
	return db
		.update(tokenWatchlist)
		.set({
			lastPrice: priceData.lastPrice.toString(),
			priceChange24h: priceData.priceChange24h.toString(),
			marketCap: priceData.marketCap.toString(),
			lastPriceUpdate: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(tokenWatchlist.workspaceId, workspaceId),
				eq(tokenWatchlist.symbol, symbol.toUpperCase()),
			),
		);
}

export async function removeFromWatchlist(workspaceId: string, symbol: string) {
	return db
		.update(tokenWatchlist)
		.set({ status: 'archived', updatedAt: new Date() })
		.where(
			and(
				eq(tokenWatchlist.workspaceId, workspaceId),
				eq(tokenWatchlist.symbol, symbol.toUpperCase()),
			),
		);
}

export async function incrementMentionCount(workspaceId: string, symbol: string) {
	return db
		.update(tokenWatchlist)
		.set({
			mentionCount: sql`${tokenWatchlist.mentionCount} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(tokenWatchlist.workspaceId, workspaceId),
				eq(tokenWatchlist.symbol, symbol.toUpperCase()),
			),
		);
}
