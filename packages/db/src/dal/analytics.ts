import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../client';
import { userBehaviors } from '../schema/behaviors';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Fire-and-forget analytics event tracking.
 * Uses the existing user_behaviors table — no new schema needed.
 *
 * Type safety is enforced at call sites (trackEvent in apps/web,
 * typed wrappers in apps/worker). This layer accepts any event string.
 *
 * userId is optional for system events (e.g. queue.depth).
 */
export function trackAnalyticsEvent(
	workspaceId: string,
	userId: string | null,
	event: string,
	properties?: Record<string, unknown>,
): void {
	void db
		.insert(userBehaviors)
		.values({
			workspaceId,
			userId: userId ?? SYSTEM_USER_ID,
			event,
			metadata: properties ?? null,
		})
		.catch(() => {});
}

/**
 * Get onboarding funnel metrics for a workspace.
 * Returns step-by-step event counts for funnel analysis.
 */
export async function getOnboardingFunnel(
	workspaceId: string,
	dateRange?: { since?: Date; until?: Date },
) {
	const conditions = [
		eq(userBehaviors.workspaceId, workspaceId),
		sql`${userBehaviors.event} LIKE 'onboarding.%'`,
	];

	if (dateRange?.since) {
		conditions.push(gte(userBehaviors.createdAt, dateRange.since));
	}
	if (dateRange?.until) {
		conditions.push(lte(userBehaviors.createdAt, dateRange.until));
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

/**
 * Get commitment pipeline stats for a workspace.
 */
export async function getCommitmentPipelineStats(
	workspaceId: string,
	dateRange?: { since?: Date; until?: Date },
) {
	const conditions = [
		eq(userBehaviors.workspaceId, workspaceId),
		sql`(${userBehaviors.event} LIKE 'commitment.%' OR ${userBehaviors.event} LIKE 'bandit.%' OR ${userBehaviors.event} IN ('confirm_commitment', 'fulfill_commitment', 'snooze_commitment'))`,
	];

	if (dateRange?.since) {
		conditions.push(gte(userBehaviors.createdAt, dateRange.since));
	}
	if (dateRange?.until) {
		conditions.push(lte(userBehaviors.createdAt, dateRange.until));
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

/**
 * Get engagement metrics for a workspace.
 */
export async function getEngagementMetrics(
	workspaceId: string,
	dateRange?: { since?: Date; until?: Date },
) {
	const conditions = [eq(userBehaviors.workspaceId, workspaceId)];

	if (dateRange?.since) {
		conditions.push(gte(userBehaviors.createdAt, dateRange.since));
	}
	if (dateRange?.until) {
		conditions.push(lte(userBehaviors.createdAt, dateRange.until));
	}

	const [eventCounts, dau] = await Promise.all([
		db
			.select({
				event: userBehaviors.event,
				count: sql<number>`count(*)::int`,
			})
			.from(userBehaviors)
			.where(and(...conditions))
			.groupBy(userBehaviors.event)
			.orderBy(sql`count(*) desc`),
		db
			.select({
				day: sql<string>`date_trunc('day', ${userBehaviors.createdAt})::date::text`,
				users: sql<number>`count(distinct ${userBehaviors.userId})::int`,
			})
			.from(userBehaviors)
			.where(and(...conditions))
			.groupBy(sql`date_trunc('day', ${userBehaviors.createdAt})`)
			.orderBy(sql`date_trunc('day', ${userBehaviors.createdAt})`),
	]);

	return { eventCounts, dau };
}
