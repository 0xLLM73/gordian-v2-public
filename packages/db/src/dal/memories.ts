import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { memories } from '../schema/memories';

export interface CreateMemoryInput {
	contactId?: string;
	category: string;
	content: string;
	contentSanitized?: string;
	embedding?: number[];
	metadata?: Record<string, unknown>;
}

export interface HybridSearchResult {
	id: string;
	content: string;
	category: string;
	rrf_score: number;
	semantic_score: number;
	fts_rank: number;
}

export interface UnembeddedMemory {
	id: string;
	content: string;
	category: string;
}

export async function createMemory(
	workspaceId: string,
	input: CreateMemoryInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		// Dedup guard: if content_sanitized matches an existing row for this
		// workspace + contact + category, skip the insert to prevent duplicates
		// from re-processing the same messages.
		if (input.contentSanitized && input.contactId) {
			const existing = await db.execute(sql`
				SELECT id FROM memories
				WHERE workspace_id = ${workspaceId}::uuid
					AND contact_id = ${input.contactId}::uuid
					AND category = ${input.category}::memory_category
					AND content_sanitized = ${input.contentSanitized}
				LIMIT 1
			`);
			if ((existing as unknown[]).length > 0) {
				return (existing as unknown as Array<{ id: string }>)[0];
			}
		}

		const result = await db
			.insert(memories)
			.values({
				workspaceId,
				contactId: input.contactId,
				category: input.category as (typeof memories.category.enumValues)[number],
				content: input.content,
				contentSanitized: input.contentSanitized,
				embedding: input.embedding,
				metadata: input.metadata ?? {},
			})
			.returning();
		return result[0] ?? null;
	});
}

export async function getMemoriesByContact(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
	options?: { category?: string; limit?: number; offset?: number },
) {
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;

	return withKeys(envelope, async () => {
		const conditions = [eq(memories.workspaceId, workspaceId), eq(memories.contactId, contactId)];

		if (options?.category) {
			conditions.push(
				eq(memories.category, options.category as (typeof memories.category.enumValues)[number]),
			);
		}

		return await db
			.select()
			.from(memories)
			.where(and(...conditions))
			.limit(limit)
			.offset(offset)
			.orderBy(memories.createdAt);
	});
}

/**
 * Fetch memories that have no embedding yet, for backfill processing.
 * Content is decrypted transparently via the encryptedText custom type
 * when inside a withKeys() context.
 *
 * IMPORTANT: Must be called from inside a withKeys() context (or wraps one
 * internally) so the encryptedText custom type can decrypt content.
 */
export async function getUnembeddedMemories(
	workspaceId: string,
	envelope: SealedEnvelope,
	limit = 100,
): Promise<UnembeddedMemory[]> {
	return withKeys(envelope, async () => {
		const rows = await db
			.select({
				id: memories.id,
				content: memories.content,
				category: memories.category,
			})
			.from(memories)
			.where(and(eq(memories.workspaceId, workspaceId), isNull(memories.embedding)))
			.limit(limit)
			.orderBy(memories.createdAt);

		return rows.map((r) => ({
			id: r.id as string,
			content: r.content,
			category: r.category,
		}));
	});
}

/**
 * Hybrid search using the hybrid_search() SQL function.
 * Combines pgvector semantic search + PostgreSQL FTS via RRF.
 */
export async function hybridSearch(
	workspaceId: string,
	queryEmbedding: number[],
	queryText: string,
	options?: { category?: string; limit?: number },
): Promise<HybridSearchResult[]> {
	const limit = options?.limit ?? 10;
	const embeddingStr = `[${queryEmbedding.join(',')}]`;

	const result = await db.execute(sql`
		SELECT * FROM hybrid_search(
			${workspaceId}::uuid,
			${embeddingStr}::halfvec(512),
			${queryText},
			${options?.category ?? null}::memory_category,
			${limit}
		)
	`);

	return result as unknown as HybridSearchResult[];
}

/**
 * Text-only search fallback using PostgreSQL full-text search.
 * Used when no query embedding is available (e.g. embedding generation not wired up).
 */
export async function textSearch(
	workspaceId: string,
	queryText: string,
	options?: { category?: string; limit?: number },
): Promise<HybridSearchResult[]> {
	const limit = options?.limit ?? 10;

	const result = await db.execute(sql`
		SELECT
			m.id,
			m.content_sanitized AS content,
			m.category,
			ts_rank(to_tsvector('english', m.content_sanitized), plainto_tsquery('english', ${queryText}))::float AS rrf_score,
			0::float AS semantic_score,
			ts_rank(to_tsvector('english', m.content_sanitized), plainto_tsquery('english', ${queryText}))::float AS fts_rank
		FROM memories m
		WHERE m.workspace_id = ${workspaceId}::uuid
			AND m.content_sanitized IS NOT NULL
			AND to_tsvector('english', m.content_sanitized) @@ plainto_tsquery('english', ${queryText})
		ORDER BY fts_rank DESC
		LIMIT ${limit}
	`);

	return result as unknown as HybridSearchResult[];
}

export async function updateMemoryEmbedding(
	workspaceId: string,
	memoryId: string,
	category: string,
	embedding: number[],
	contentSanitized: string,
) {
	const embeddingStr = `[${embedding.join(',')}]`;

	await db.execute(sql`
		UPDATE memories
		SET embedding = ${embeddingStr}::halfvec(512),
			content_sanitized = ${contentSanitized},
			updated_at = NOW()
		WHERE id = ${memoryId}
		AND workspace_id = ${workspaceId}::uuid
		AND category = ${category}::memory_category
	`);
}
