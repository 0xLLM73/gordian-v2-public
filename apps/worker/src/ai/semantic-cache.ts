import { createHash } from 'node:crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { checkCache, invalidateCache, storeCache } from '@repo/db';
import { generateEmbedding } from './embeddings';

/**
 * Semantic Cache Module (P2):
 * Caches chat responses by query similarity to avoid redundant LLM calls.
 *
 * Uses a two-tier lookup:
 * 1. Exact match on SHA-256 hash of masked query (fast path)
 * 2. Cosine similarity on query embedding (semantic match, threshold 0.95)
 *
 * CRITICAL: maskedQuery must already be ELM-masked before calling these functions.
 * The caller (chat-stream.ts) is responsible for ELM masking.
 */

/**
 * Check the semantic cache for a matching response.
 * Returns the cached response string if found, null otherwise.
 */
export async function checkSemanticCache(
	workspaceId: string,
	maskedQuery: string,
	queryEmbedding: number[],
	envelope: SealedEnvelope,
): Promise<string | null> {
	try {
		const queryHash = createHash('sha256').update(maskedQuery).digest('hex');
		const result = await checkCache(workspaceId, queryHash, queryEmbedding, envelope);
		return result?.response ?? null;
	} catch (err) {
		console.error('[semantic-cache] checkCache error:', (err as Error).message);
		return null;
	}
}

/**
 * Store a chat response in the semantic cache.
 * Hashes the masked query for exact-match lookups and stores the embedding
 * for semantic similarity searches.
 */
export async function storeSemanticCache(
	workspaceId: string,
	maskedQuery: string,
	queryEmbedding: number[],
	response: string,
	toolsUsed: string[],
	envelope: SealedEnvelope,
): Promise<void> {
	try {
		const queryHash = createHash('sha256').update(maskedQuery).digest('hex');
		await storeCache(
			workspaceId,
			queryHash,
			maskedQuery,
			queryEmbedding,
			response,
			toolsUsed,
			envelope,
		);
	} catch (err) {
		console.error('[semantic-cache] storeCache error:', (err as Error).message);
	}
}

/**
 * Invalidate cached responses when write tools execute.
 * Deletes cache entries whose tools_used array contains the given tool name.
 */
export async function invalidateCacheForTool(workspaceId: string, toolName: string): Promise<void> {
	try {
		await invalidateCache(workspaceId, toolName);
	} catch (err) {
		console.error('[semantic-cache] invalidateCache error:', (err as Error).message);
	}
}

/**
 * Generate embedding for a masked query string.
 * Convenience wrapper — the query MUST already be ELM-masked.
 */
export async function embedMaskedQuery(maskedQuery: string): Promise<number[]> {
	return generateEmbedding(maskedQuery);
}
