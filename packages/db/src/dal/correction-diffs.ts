import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { correctionDiffs } from '../schema/correction-diffs';

export interface CreateCorrectionDiffInput {
	workspaceId?: string;
	goldenId: string;
	diffType:
		| 'hallucination'
		| 'missing_field'
		| 'format_error'
		| 'wrong_entity'
		| 'wrong_date'
		| 'wrong_type'
		| 'false_positive'
		| 'false_negative'
		| 'confidence_miscalibration'
		| 'other';
	severityScore: number;
	description?: string;
	mistakeEmbedding?: number[];
}

export async function createCorrectionDiff(input: CreateCorrectionDiffInput) {
	const result = await db
		.insert(correctionDiffs)
		.values({
			workspaceId: input.workspaceId,
			goldenId: input.goldenId,
			diffType: input.diffType,
			severityScore: input.severityScore,
			description: input.description,
			mistakeEmbedding: input.mistakeEmbedding,
			analyzedAt: new Date(),
		})
		.returning();
	return result[0] ?? null;
}

/**
 * Get diffs where mistakeEmbedding is NULL (need embedding backfill).
 */
export async function getUnembeddedDiffs(limit = 100) {
	return db
		.select()
		.from(correctionDiffs)
		.where(isNull(correctionDiffs.mistakeEmbedding))
		.limit(limit);
}

/**
 * Update a diff's embedding after backfill generation.
 */
export async function updateDiffEmbedding(diffId: string, embedding: number[]) {
	const result = await db
		.update(correctionDiffs)
		.set({ mistakeEmbedding: embedding })
		.where(eq(correctionDiffs.id, diffId))
		.returning();
	return result[0] ?? null;
}

/**
 * Get diffs that have an embedding but no assigned pattern (ready for clustering).
 */
export async function getUnclusteredDiffs(limit = 1000) {
	return db
		.select()
		.from(correctionDiffs)
		.where(and(isNotNull(correctionDiffs.mistakeEmbedding), isNull(correctionDiffs.patternId)))
		.limit(limit);
}

/**
 * Get all diff embeddings for DBSCAN clustering input.
 * Returns id + raw embedding pairs.
 */
export async function getAllDiffEmbeddings(limit = 5000) {
	const rows = await db.execute(sql`
		SELECT id, mistake_embedding::text AS embedding_text
		FROM correction_diffs
		WHERE mistake_embedding IS NOT NULL
		  AND pattern_id IS NULL
		ORDER BY analyzed_at DESC
		LIMIT ${limit}
	`);

	return (rows as unknown as Array<{ id: string; embedding_text: string }>).map((row) => ({
		id: row.id,
		embedding: row.embedding_text.replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number),
	}));
}

/**
 * Batch assign a pattern to multiple diffs.
 */
export async function assignPatternToDiffs(diffIds: string[], patternId: string) {
	if (diffIds.length === 0) return;

	await db.update(correctionDiffs).set({ patternId }).where(inArray(correctionDiffs.id, diffIds));
}

/**
 * Get all diffs for a specific golden dataset example.
 */
export async function getDiffsByGoldenId(goldenId: string) {
	return db.select().from(correctionDiffs).where(eq(correctionDiffs.goldenId, goldenId));
}
