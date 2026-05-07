import type { SealedEnvelope } from '@repo/crypto';
import { computeBlindIndex, keyStore, withKeys } from '@repo/crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { commitments } from '../schema/commitments';
import { deals } from '../schema/deals';
import { searchContactByName } from './contacts';
import { hybridSearch, textSearch } from './memories';

export interface UnifiedSearchResult {
	contacts: Array<Record<string, unknown>>;
	memories: Array<{
		id: string;
		content: string;
		category: string;
		rrf_score: number;
	}>;
	commitments: Array<Record<string, unknown>>;
	deals: Array<Record<string, unknown>>;
}

export async function unifiedSearch(
	workspaceId: string,
	query: string,
	envelope: SealedEnvelope,
	queryEmbedding: number[] | null,
	options?: { limit?: number },
): Promise<UnifiedSearchResult> {
	const limit = options?.limit ?? 10;

	// Fan out searches in parallel
	const [contactResults, memoryResults, commitmentResults, dealResults] = await Promise.all([
		// 1. Contact search via blind index (exact name match)
		searchContactByName(workspaceId, query, envelope).catch(() => []),

		// 2. Memory search via hybrid RRF (requires embedding)
		queryEmbedding
			? hybridSearch(workspaceId, queryEmbedding, query, { limit }).catch(() => [])
			: textSearch(workspaceId, query, { limit }).catch(() => []),

		// 3. Commitment search via embedding similarity (Drizzle ORM for customType decrypt)
		// SEC-ENC-502: title is encrypted — ILIKE impossible on ciphertext
		// SEC-ENC-515: must use Drizzle ORM, not raw SQL — raw SQL bypasses encryptedText.fromDriver()
		queryEmbedding
			? withKeys(envelope, async () => {
					const embStr = `[${queryEmbedding.join(',')}]`;
					return db
						.select()
						.from(commitments)
						.where(and(eq(commitments.workspaceId, workspaceId), isNotNull(commitments.embedding)))
						.orderBy(sql`${commitments.embedding} <=> ${embStr}::halfvec(512)`)
						.limit(limit);
				}).catch(() => [])
			: Promise.resolve([]),

		// 4. Deal search via blind index exact match on title
		// SEC-ENC-502: title/notes encrypted — ILIKE impossible on ciphertext
		withKeys(envelope, async () => {
			const keys = keyStore.getStore();
			if (!keys) throw new Error('keyStore not initialized in search');
			const blindIdx = computeBlindIndex(query, keys.bik);
			return db
				.select()
				.from(deals)
				.where(and(eq(deals.workspaceId, workspaceId), eq(deals.titleBlindIndex, blindIdx)))
				.limit(limit);
		}).catch(() => []),
	]);

	return {
		contacts: Array.isArray(contactResults) ? contactResults : [],
		memories: memoryResults,
		commitments: commitmentResults,
		deals: dealResults,
	};
}
