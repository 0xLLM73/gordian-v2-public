import { db, sql } from '@repo/db';

/**
 * 2-Stage Deduplication Funnel:
 * Stage 1: Semantic (pgvector cosine on all non-dismissed commitments)
 * Stage 2: Causal (decision graph, prevents zombie tasks)
 *
 * NOTE: title field is encrypted (encryptedText), so pg_trgm similarity on
 * ciphertext is meaningless. We rely on embedding similarity which operates
 * on the masked (pre-encryption) title embedding stored alongside the row.
 */

export type DedupResult = 'create' | 'merge' | 'flag' | 'dismiss';

const COMMITMENT_EMBEDDING_DIMENSIONS = 512;
const DECISION_EMBEDDING_DIMENSIONS = 1536;

function toVectorLiteral(embedding: number[]): string {
	return `[${embedding.join(',')}]`;
}

export async function deduplicateCommitment(
	workspaceId: string,
	contactId: string,
	_newTitle: string,
	newEmbedding: number[],
): Promise<DedupResult> {
	if (newEmbedding.length < COMMITMENT_EMBEDDING_DIMENSIONS) {
		console.warn(
			`[dedup] Skipping commitment dedup: expected at least ${COMMITMENT_EMBEDDING_DIMENSIONS} dimensions, got ${newEmbedding.length}`,
		);
		return 'create';
	}

	const commitmentEmbeddingStr = toVectorLiteral(
		newEmbedding.slice(0, COMMITMENT_EMBEDDING_DIMENSIONS),
	);

	// Stage 1: Semantic — cosine similarity against ALL non-dismissed commitments
	// (not just 'active' — draft commitments must also be deduped)
	const semanticMatch = await db.execute(sql`
		SELECT id,
			1 - (embedding <=> ${commitmentEmbeddingStr}::halfvec(512)) as similarity
		FROM commitments
		WHERE contact_id = ${contactId}::uuid
			AND workspace_id = ${workspaceId}::uuid
			AND status != 'dismissed'
			AND embedding IS NOT NULL
		ORDER BY embedding <=> ${commitmentEmbeddingStr}::halfvec(512)
		LIMIT 1
	`);

	const semanticResults = semanticMatch as unknown as Array<{ similarity: number }>;
	if (semanticResults.length > 0) {
		const sim = semanticResults[0].similarity;
		if (sim > 0.9) return 'merge';
		if (sim > 0.82) return 'flag';
	}

	// Stage 2: Causal — check decision graph for recent dismissals.
	// user_decisions still uses vector(1536); only run this path when the caller
	// supplies a full graph embedding so 512-dim commitment embeddings do not fail.
	if (newEmbedding.length !== DECISION_EMBEDDING_DIMENSIONS) return 'create';

	const decisionEmbeddingStr = toVectorLiteral(newEmbedding);
	const dismissedMatch = await db.execute(sql`
		SELECT id FROM user_decisions
		WHERE 1 - (embedding <=> ${decisionEmbeddingStr}::vector(1536)) > 0.9
			AND decision_type = 'dismissal'
			AND created_at > NOW() - INTERVAL '7 DAYS'
			AND workspace_id = ${workspaceId}::uuid
		LIMIT 1
	`);

	if ((dismissedMatch as unknown[]).length > 0) return 'dismiss';

	return 'create';
}
