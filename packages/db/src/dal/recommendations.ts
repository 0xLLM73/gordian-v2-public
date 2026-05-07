import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { recommendations } from '../schema/recommendations';

export type Recommendation = typeof recommendations.$inferSelect;
export type RecommendationType =
	| 're_engage'
	| 'follow_up'
	| 'advance_deal'
	| 'make_intro'
	| 'achieve_goal';

export interface CreateRecommendationItem {
	contactId?: string;
	type: RecommendationType;
	priorityScore: number;
	reasoning: string;
	expiresAt?: Date;
}

/**
 * Batch-insert a list of recommendations for a workspace.
 * Existing recommendations are not deduplicated here — the caller
 * (recommendations engine) is responsible for clearing stale items first.
 */
export async function createRecommendations(
	workspaceId: string,
	items: CreateRecommendationItem[],
): Promise<Recommendation[]> {
	if (items.length === 0) return [];
	return db
		.insert(recommendations)
		.values(
			items.map((item) => ({
				workspaceId,
				contactId: item.contactId,
				type: item.type,
				priorityScore: item.priorityScore,
				reasoning: item.reasoning,
				expiresAt: item.expiresAt,
			})),
		)
		.returning();
}

/**
 * Return pending recommendations that have not yet expired,
 * ordered by priority score descending.
 */
export async function getPendingRecommendations(
	workspaceId: string,
	limit = 10,
): Promise<Recommendation[]> {
	return db
		.select()
		.from(recommendations)
		.where(
			and(
				eq(recommendations.workspaceId, workspaceId),
				eq(recommendations.status, 'pending'),
				or(isNull(recommendations.expiresAt), lt(sql`now()`, recommendations.expiresAt)),
			),
		)
		.orderBy(sql`${recommendations.priorityScore} desc`)
		.limit(limit);
}

/**
 * Mark a recommendation as acted on by the user.
 * workspace_id required to prevent cross-tenant mutation.
 */
export async function actOnRecommendation(
	id: string,
	workspaceId: string,
): Promise<Recommendation | null> {
	const result = await db
		.update(recommendations)
		.set({ status: 'acted' })
		.where(and(eq(recommendations.id, id), eq(recommendations.workspaceId, workspaceId)))
		.returning();
	return result[0] ?? null;
}

/**
 * Mark a recommendation as dismissed by the user.
 * workspace_id required to prevent cross-tenant mutation.
 */
export async function dismissRecommendation(
	id: string,
	workspaceId: string,
): Promise<Recommendation | null> {
	const result = await db
		.update(recommendations)
		.set({ status: 'dismissed' })
		.where(and(eq(recommendations.id, id), eq(recommendations.workspaceId, workspaceId)))
		.returning();
	return result[0] ?? null;
}

/**
 * Expire all pending recommendations that are past their expiry time.
 * Run nightly by the recommendations worker.
 */
export async function expireOldRecommendations(workspaceId: string): Promise<number> {
	const result = await db
		.update(recommendations)
		.set({ status: 'expired' })
		.where(
			and(
				eq(recommendations.workspaceId, workspaceId),
				eq(recommendations.status, 'pending'),
				lt(recommendations.expiresAt, sql`now()`),
			),
		)
		.returning({ id: recommendations.id });
	return result.length;
}
