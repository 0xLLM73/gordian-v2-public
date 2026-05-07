import { eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { semanticPatterns } from '../schema/semantic-patterns';

export interface CreateSemanticPatternInput {
	featureDomain: string;
	patternText: string;
	embedding?: number[];
	confidenceScore?: number;
}

export async function createSemanticPattern(input: CreateSemanticPatternInput) {
	const result = await db
		.insert(semanticPatterns)
		.values({
			featureDomain: input.featureDomain,
			patternText: input.patternText,
			embedding: input.embedding,
			confidenceScore: input.confidenceScore ?? 0.5,
			lastReinforced: new Date(),
		})
		.returning();
	return result[0] ?? null;
}

/**
 * Get top patterns for a feature domain, ordered by confidence + recency.
 */
export async function getTopPatterns(featureDomain: string, limit = 20) {
	return db
		.select()
		.from(semanticPatterns)
		.where(eq(semanticPatterns.featureDomain, featureDomain))
		.orderBy(sql`confidence_score DESC, last_reinforced DESC NULLS LAST`)
		.limit(limit);
}

/**
 * Find similar patterns by cosine similarity search.
 */
export async function findSimilarPatterns(embedding: number[], featureDomain: string, limit = 5) {
	const embeddingStr = `[${embedding.join(',')}]`;

	const rows = await db.execute(sql`
		SELECT id, feature_domain, pattern_text, confidence_score, occurrence_count,
			   1 - (embedding <=> ${embeddingStr}::halfvec(512)) AS similarity
		FROM semantic_patterns
		WHERE feature_domain = ${featureDomain}
		  AND embedding IS NOT NULL
		ORDER BY embedding <=> ${embeddingStr}::halfvec(512)
		LIMIT ${limit}
	`);

	return rows as unknown as Array<{
		id: string;
		feature_domain: string;
		pattern_text: string;
		confidence_score: number;
		occurrence_count: number;
		similarity: number;
	}>;
}

/**
 * Reinforce an existing pattern: increment count, bump timestamp, nudge confidence.
 */
export async function reinforcePattern(patternId: string) {
	const result = await db
		.update(semanticPatterns)
		.set({
			occurrenceCount: sql`occurrence_count + 1`,
			lastReinforced: new Date(),
			confidenceScore: sql`LEAST(confidence_score + 0.02, 1.0)`,
		})
		.where(eq(semanticPatterns.id, patternId))
		.returning();
	return result[0] ?? null;
}
