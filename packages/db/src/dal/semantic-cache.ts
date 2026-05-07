import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../client';
import { semanticCache } from '../schema/semantic-cache';

export interface CacheHit {
	id: string;
	response: string;
	toolsUsed: string[];
	createdAt: Date;
}

/**
 * Check cache for a matching LLM response.
 * Step 1: exact match on query_hash (fast B-tree path).
 * Step 2: cosine similarity > 0.95 via HNSW (withIterativeScan).
 *
 * SEC-050: workspace_id in every query.
 * SEC-051: withKeys for decryption.
 */
export async function checkCache(
	workspaceId: string,
	queryHash: string,
	queryEmbedding: number[],
	envelope: SealedEnvelope,
): Promise<CacheHit | null> {
	return withKeys(envelope, async () => {
		// Step 1: exact hash match
		const exactMatch = await db
			.select({
				id: semanticCache.id,
				response: semanticCache.response,
				toolsUsed: semanticCache.toolsUsed,
				createdAt: semanticCache.createdAt,
			})
			.from(semanticCache)
			.where(
				and(
					eq(semanticCache.workspaceId, workspaceId),
					eq(semanticCache.queryHash, queryHash),
					gt(semanticCache.expiresAt, sql`now()`),
				),
			)
			.limit(1);

		if (exactMatch.length > 0) {
			return {
				id: exactMatch[0].id,
				response: exactMatch[0].response,
				toolsUsed: exactMatch[0].toolsUsed,
				createdAt: exactMatch[0].createdAt,
			};
		}

		// Step 2: semantic similarity via HNSW (iterative scan for multi-tenant filtering)
		const embeddingStr = `[${queryEmbedding.join(',')}]`;
		const semanticMatch = await db.transaction(async (tx) => {
			await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
			return tx.execute(sql`
				SELECT id, response, tools_used, created_at,
					1 - (query_embedding <=> ${embeddingStr}::halfvec(512)) AS similarity
				FROM semantic_cache
				WHERE workspace_id = ${workspaceId}
					AND expires_at > now()
				ORDER BY query_embedding <=> ${embeddingStr}::halfvec(512)
				LIMIT 1
			`);
		});

		const rows = semanticMatch as unknown as Array<{
			id: string;
			response: string;
			tools_used: string[];
			created_at: Date;
			similarity: number;
		}>;

		if (rows.length > 0 && rows[0].similarity > 0.95) {
			return {
				id: rows[0].id,
				response: rows[0].response,
				toolsUsed: rows[0].tools_used,
				createdAt: rows[0].created_at,
			};
		}

		return null;
	});
}

/**
 * Store an LLM response in the semantic cache.
 * SEC-050: workspace_id required.
 * SEC-013: response encrypted via withKeys.
 */
export async function storeCache(
	workspaceId: string,
	queryHash: string,
	maskedQuery: string,
	queryEmbedding: number[],
	response: string,
	toolsUsed: string[],
	envelope: SealedEnvelope,
): Promise<void> {
	await withKeys(envelope, async () => {
		await db.insert(semanticCache).values({
			workspaceId,
			queryHash,
			maskedQuery,
			queryEmbedding,
			response,
			toolsUsed,
			expiresAt: sql`now() + interval '1 hour'`,
		});
	});
}

/**
 * Invalidate cache entries that used a specific tool.
 * Used when underlying data changes (e.g., contact updated → invalidate entries
 * that used search_contacts tool).
 * SEC-050: workspace_id scoped.
 */
export async function invalidateCache(workspaceId: string, toolName: string): Promise<number> {
	const result = await db
		.delete(semanticCache)
		.where(
			and(
				eq(semanticCache.workspaceId, workspaceId),
				sql`${semanticCache.toolsUsed} @> ARRAY[${toolName}]::text[]`,
			),
		)
		.returning({ id: semanticCache.id });
	return result.length;
}

/**
 * Delete all expired cache entries across all workspaces.
 * Called by scheduled cleanup job.
 */
export async function cleanupExpiredCache(): Promise<number> {
	const result = await db
		.delete(semanticCache)
		.where(sql`${semanticCache.expiresAt} < now()`)
		.returning({ id: semanticCache.id });
	return result.length;
}
