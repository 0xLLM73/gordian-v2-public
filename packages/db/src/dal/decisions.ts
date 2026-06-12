import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, desc, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { causalEdges, userDecisions } from '../schema/decisions';

export interface CreateDecisionInput {
	userId: string;
	rawContent: string;
	decisionType: 'message' | 'click' | 'view' | 'purchase' | 'commitment' | 'dismissal';
	embedding?: number[];
	interactionMetadata?: Record<string, unknown>;
	entityId?: string;
}

export interface CreateEdgeInput {
	sourceId: string;
	targetId: string;
	edgeType: 'explicit_reply' | 'implicit_context' | 'temporal' | 'semantic';
	weight?: number;
	confidenceScore?: number;
}

export interface GraphSearchResult {
	id: string;
	depth: number;
	semantic_distance: number;
}

export async function createDecision(
	workspaceId: string,
	input: CreateDecisionInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(userDecisions)
			.values({
				workspaceId,
				userId: input.userId,
				rawContent: input.rawContent,
				decisionType: input.decisionType,
				embedding: input.embedding,
				interactionMetadata: input.interactionMetadata ?? {},
				entityId: input.entityId,
			})
			.returning();
		return result[0] ?? null;
	});
}

export async function createEdge(workspaceId: string, input: CreateEdgeInput) {
	// Verify both source and target decisions belong to the caller's workspace (SEC-056)
	const [source, target] = await Promise.all([
		db
			.select({ id: userDecisions.id })
			.from(userDecisions)
			.where(and(eq(userDecisions.id, input.sourceId), eq(userDecisions.workspaceId, workspaceId)))
			.limit(1),
		db
			.select({ id: userDecisions.id })
			.from(userDecisions)
			.where(and(eq(userDecisions.id, input.targetId), eq(userDecisions.workspaceId, workspaceId)))
			.limit(1),
	]);

	if (source.length === 0 || target.length === 0) {
		throw new Error('Source or target decision not found in workspace');
	}

	const result = await db
		.insert(causalEdges)
		.values({
			workspaceId,
			sourceId: input.sourceId,
			targetId: input.targetId,
			edgeType: input.edgeType,
			weight: input.weight ?? 0.5,
			confidenceScore: input.confidenceScore ?? 0.5,
		})
		.returning();
	return result[0] ?? null;
}

/**
 * GraphRAG search using the graphrag_search() SQL function.
 * 3-hop recursive CTE for causal intelligence.
 */
export async function graphragSearch(
	workspaceId: string,
	queryEmbedding: number[],
	options?: { maxDepth?: number; similarityThreshold?: number; limit?: number },
): Promise<GraphSearchResult[]> {
	const maxDepth = options?.maxDepth ?? 3;
	const threshold = options?.similarityThreshold ?? 0.2;
	const limit = options?.limit ?? 20;
	const embeddingStr = `[${queryEmbedding.join(',')}]`;

	const result = await db.execute(sql`
		SELECT id, depth, semantic_distance FROM graphrag_search(
			${workspaceId}::uuid,
			${embeddingStr}::vector(1536),
			${maxDepth},
			${threshold},
			${limit}
		)
	`);

	return result as unknown as GraphSearchResult[];
}

export async function getDecisionsByWorkspace(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number },
) {
	const limit = options?.limit ?? 50;

	return withKeys(
		envelope,
		async () =>
			await db
				.select()
				.from(userDecisions)
				.where(eq(userDecisions.workspaceId, workspaceId))
				.limit(limit)
				.orderBy(userDecisions.createdAt),
	);
}

// ─── Context Graph Completion DAL functions ──────────────────────────────────

/**
 * Find the most recent decision within a time window.
 */
export async function findRecentDecision(
	workspaceId: string,
	options?: { excludeId?: string; withinHours?: number },
): Promise<{ id: string; createdAt: Date } | null> {
	const withinHours = options?.withinHours ?? 24;
	const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);

	const conditions = [
		eq(userDecisions.workspaceId, workspaceId),
		gt(userDecisions.createdAt, cutoff),
	];
	if (options?.excludeId) {
		conditions.push(sql`${userDecisions.id} != ${options.excludeId}`);
	}

	const rows = await db
		.select({ id: userDecisions.id, createdAt: userDecisions.createdAt })
		.from(userDecisions)
		.where(and(...conditions))
		.orderBy(desc(userDecisions.createdAt))
		.limit(1);

	return rows[0] ?? null;
}

/**
 * Find decisions similar to a given embedding via pgvector cosine distance.
 */
export async function findSimilarDecisions(
	workspaceId: string,
	embedding: number[],
	options?: { excludeId?: string; minSimilarity?: number; limit?: number },
): Promise<Array<{ id: string; similarity: number }>> {
	const minSimilarity = options?.minSimilarity ?? 0.85;
	const limit = options?.limit ?? 3;
	const maxDistance = 1 - minSimilarity;
	const embeddingStr = `[${embedding.join(',')}]`;

	const conditions = [
		eq(userDecisions.workspaceId, workspaceId),
		isNotNull(userDecisions.embedding),
		sql`(${userDecisions.embedding} <=> ${embeddingStr}::vector) < ${maxDistance}`,
	];
	if (options?.excludeId) {
		conditions.push(sql`${userDecisions.id} != ${options.excludeId}`);
	}

	const rows = await db
		.select({
			id: userDecisions.id,
			similarity: sql<number>`1 - (${userDecisions.embedding} <=> ${embeddingStr}::vector)`,
		})
		.from(userDecisions)
		.where(and(...conditions))
		.orderBy(sql`${userDecisions.embedding} <=> ${embeddingStr}::vector`)
		.limit(limit);

	return rows;
}

/**
 * Look up a decision by its linked entity ID.
 */
export async function findDecisionByEntityId(
	workspaceId: string,
	entityId: string,
): Promise<{ id: string } | null> {
	const rows = await db
		.select({ id: userDecisions.id })
		.from(userDecisions)
		.where(and(eq(userDecisions.workspaceId, workspaceId), eq(userDecisions.entityId, entityId)))
		.limit(1);

	return rows[0] ?? null;
}

/**
 * Adjust an edge's weight by a delta, clamped to [minWeight, maxWeight].
 */
export async function updateEdgeWeight(
	workspaceId: string,
	edgeId: string,
	weightDelta: number,
	options?: { minWeight?: number; maxWeight?: number },
): Promise<void> {
	const minWeight = options?.minWeight ?? 0.1;
	const maxWeight = options?.maxWeight ?? 1.0;

	await db
		.update(causalEdges)
		.set({
			weight: sql`GREATEST(${minWeight}, LEAST(${maxWeight}, ${causalEdges.weight} + ${weightDelta}))`,
		})
		.where(and(eq(causalEdges.id, edgeId), eq(causalEdges.workspaceId, workspaceId)));
}

/**
 * Find all causal edges pointing to a target decision.
 */
export async function findEdgesByTargetDecision(
	workspaceId: string,
	targetDecisionId: string,
): Promise<Array<{ id: string; weight: number; sourceId: string }>> {
	return db
		.select({
			id: causalEdges.id,
			weight: causalEdges.weight,
			sourceId: causalEdges.sourceId,
		})
		.from(causalEdges)
		.where(
			and(eq(causalEdges.workspaceId, workspaceId), eq(causalEdges.targetId, targetDecisionId)),
		);
}

/**
 * Decrease confidence on edges older than N days. Returns count of updated rows.
 */
export async function decayStaleEdges(
	workspaceId: string,
	options?: { olderThanDays?: number; decayAmount?: number; minConfidence?: number },
): Promise<number> {
	const olderThanDays = options?.olderThanDays ?? 30;
	const decayAmount = options?.decayAmount ?? 0.1;
	const minConfidence = options?.minConfidence ?? 0.1;
	const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

	const result = await db
		.update(causalEdges)
		.set({
			confidenceScore: sql`GREATEST(${minConfidence}, ${causalEdges.confidenceScore} - ${decayAmount})`,
		})
		.where(
			and(
				eq(causalEdges.workspaceId, workspaceId),
				lt(causalEdges.createdAt, cutoff),
				gt(causalEdges.confidenceScore, minConfidence),
			),
		)
		.returning({ id: causalEdges.id });

	return result.length;
}
