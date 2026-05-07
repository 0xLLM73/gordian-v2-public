import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { userBehaviors } from '../schema/behaviors';

export async function trackBehavior(
	workspaceId: string,
	userId: string,
	event: string,
	metadata?: Record<string, unknown>,
) {
	const result = await db
		.insert(userBehaviors)
		.values({ workspaceId, userId, event, metadata: metadata ?? null })
		.returning();
	return result[0] ?? null;
}

export async function getBehaviorCounts(
	workspaceId: string,
	options?: { since?: Date; until?: Date },
) {
	const conditions = [eq(userBehaviors.workspaceId, workspaceId)];

	if (options?.since) {
		conditions.push(sql`${userBehaviors.createdAt} >= ${options.since.toISOString()}`);
	}
	if (options?.until) {
		conditions.push(sql`${userBehaviors.createdAt} <= ${options.until.toISOString()}`);
	}

	return db
		.select({
			event: userBehaviors.event,
			count: sql<number>`count(*)::int`,
		})
		.from(userBehaviors)
		.where(and(...conditions))
		.groupBy(userBehaviors.event)
		.orderBy(sql`count(*) desc`);
}
