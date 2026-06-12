import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { goalProgressEvents, goals } from '../schema/goals';

export interface CreateGoalInput {
	type: 'relationship' | 'business' | 'habit' | 'network' | 'strategic';
	title: string;
	description?: string;
	targetCount: number;
	contactId?: string;
	targetDate?: Date;
}

export async function createGoal(
	workspaceId: string,
	input: CreateGoalInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(goals)
			.values({
				workspaceId,
				type: input.type,
				title: input.title,
				titleBlindIndex: input.title,
				description: input.description,
				targetCount: input.targetCount,
				contactId: input.contactId,
				targetDate: input.targetDate,
			})
			.returning();
		return result[0] ?? null;
	});
}

function getSortClause(sort?: string) {
	switch (sort) {
		case 'deadline':
			return sql`${goals.targetDate} asc nulls last`;
		case 'progress':
			return sql`(${goals.currentCount}::float / GREATEST(${goals.targetCount}, 1)) desc`;
		default:
			return sql`${goals.createdAt} desc`;
	}
}

export async function listGoals(
	workspaceId: string,
	options:
		| {
				status?: string;
				type?: string;
				sort?: string;
				contactId?: string;
				limit?: number;
				offset?: number;
		  }
		| undefined,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const limit = options?.limit ?? 50;
		const offset = options?.offset ?? 0;
		const conditions = [eq(goals.workspaceId, workspaceId)];

		if (options?.status) {
			conditions.push(eq(goals.status, options.status as (typeof goals.status.enumValues)[number]));
		}
		if (options?.type) {
			conditions.push(eq(goals.type, options.type as (typeof goals.type.enumValues)[number]));
		}
		if (options?.contactId) {
			conditions.push(eq(goals.contactId, options.contactId));
		}

		return db
			.select()
			.from(goals)
			.where(and(...conditions))
			.limit(limit)
			.offset(offset)
			.orderBy(getSortClause(options?.sort));
	});
}

export async function getGoal(workspaceId: string, goalId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(goals)
			.where(and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId)))
			.limit(1);
		return result[0] ?? null;
	});
}

export type GoalProgressSource = 'manual' | 'network' | 'relationship' | 'habit' | 'business';

/**
 * Atomic increment — concurrent-safe.
 * Uses LEAST(current + N, target) to prevent overshoot.
 * Auto-completes when current >= target.
 * Records a progress event with source attribution.
 */
export async function updateGoalProgress(
	workspaceId: string,
	goalId: string,
	increment = 1,
	source: GoalProgressSource = 'manual',
) {
	// SEC-ENC-507: Only return non-encrypted fields — title/description are encrypted
	const result = await db
		.update(goals)
		.set({
			currentCount: sql`LEAST(${goals.currentCount} + ${increment}, ${goals.targetCount})`,
		})
		.where(
			and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId), eq(goals.status, 'active')),
		)
		.returning({
			id: goals.id,
			currentCount: goals.currentCount,
			targetCount: goals.targetCount,
			status: goals.status,
		});

	const updated = result[0];
	if (!updated) return null;

	// Record the progress event
	await db.insert(goalProgressEvents).values({
		goalId,
		workspaceId,
		delta: increment,
		source,
	});

	// Auto-complete if target reached
	if (updated.currentCount >= updated.targetCount && updated.status === 'active') {
		const completed = await db
			.update(goals)
			.set({ status: 'completed', completedAt: sql`now()` })
			.where(and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId)))
			.returning({
				id: goals.id,
				currentCount: goals.currentCount,
				targetCount: goals.targetCount,
				status: goals.status,
			});
		return completed[0] ?? updated;
	}

	return updated;
}

export async function updateGoalStatus(
	workspaceId: string,
	goalId: string,
	status: 'paused' | 'active' | 'abandoned',
) {
	// SEC-ENC-507: Only return non-encrypted fields — title/description are encrypted
	const result = await db
		.update(goals)
		.set({ status })
		.where(and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId)))
		.returning({ id: goals.id, status: goals.status });
	return result[0] ?? null;
}

export interface UpdateGoalInput {
	title?: string;
	description?: string | null;
	type?: 'relationship' | 'business' | 'habit' | 'network' | 'strategic';
	targetCount?: number;
	targetDate?: Date | null;
}

export async function updateGoal(
	workspaceId: string,
	goalId: string,
	input: UpdateGoalInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const set: Record<string, unknown> = {};
		if (input.title !== undefined) {
			set.title = input.title;
			set.titleBlindIndex = input.title;
		}
		if (input.description !== undefined) set.description = input.description;
		if (input.type !== undefined) set.type = input.type;
		if (input.targetCount !== undefined) set.targetCount = input.targetCount;
		if (input.targetDate !== undefined) set.targetDate = input.targetDate;

		if (Object.keys(set).length === 0) return null;

		const result = await db
			.update(goals)
			.set(set)
			.where(and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

export async function deleteGoal(workspaceId: string, goalId: string) {
	const result = await db
		.delete(goals)
		.where(and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId)))
		.returning({ id: goals.id });
	return result[0] ?? null;
}

/** Fetch progress history for a goal, newest first */
export async function listGoalProgressEvents(
	workspaceId: string,
	goalId: string,
	options?: { limit?: number },
) {
	const limit = options?.limit ?? 100;
	return db
		.select()
		.from(goalProgressEvents)
		.where(
			and(eq(goalProgressEvents.goalId, goalId), eq(goalProgressEvents.workspaceId, workspaceId)),
		)
		.orderBy(desc(goalProgressEvents.createdAt))
		.limit(limit);
}

/**
 * Query active goals by workspace + type, with optional contactId filter.
 * Used by auto-tracking hooks to find goals that need incrementing.
 */
export async function getActiveGoalsByType(
	workspaceId: string,
	type: string,
	contactId: string | undefined,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const conditions = [
			eq(goals.workspaceId, workspaceId),
			eq(goals.type, type as (typeof goals.type.enumValues)[number]),
			eq(goals.status, 'active'),
		];

		if (contactId) {
			conditions.push(eq(goals.contactId, contactId));
		}

		return db
			.select()
			.from(goals)
			.where(and(...conditions));
	});
}

// ─── Goal Proposals (GI4) ────────────────────────────────────────────────────

/**
 * Check if a goal with a matching title already exists (any non-dismissed status).
 * Uses blind index for encrypted title comparison.
 * Returns true if a duplicate exists → caller should skip.
 */
export async function isDuplicateGoal(
	workspaceId: string,
	title: string,
	envelope: SealedEnvelope,
): Promise<boolean> {
	return withKeys(envelope, async () => {
		const result = await db
			.select({ id: goals.id })
			.from(goals)
			.where(
				and(
					eq(goals.workspaceId, workspaceId),
					eq(goals.titleBlindIndex, title),
					sql`${goals.status} != 'dismissed'`,
				),
			)
			.limit(1);
		return result.length > 0;
	});
}

/**
 * Create a goal proposal (status='proposed') from AI extraction.
 * User must confirm before it becomes active.
 */
export async function createGoalProposal(
	workspaceId: string,
	input: Omit<CreateGoalInput, 'targetCount'> & { targetCount?: number },
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(goals)
			.values({
				workspaceId,
				type: input.type,
				title: input.title,
				titleBlindIndex: input.title,
				description: input.description,
				targetCount: input.targetCount ?? 1,
				contactId: input.contactId,
				targetDate: input.targetDate,
				status: 'proposed',
			})
			.returning();
		return result[0] ?? null;
	});
}

/**
 * Confirm a proposed goal → set status to 'active'.
 */
export async function confirmGoalProposal(workspaceId: string, goalId: string) {
	const result = await db
		.update(goals)
		.set({ status: 'active' })
		.where(
			and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId), eq(goals.status, 'proposed')),
		)
		.returning({ id: goals.id, status: goals.status });
	return result[0] ?? null;
}

/**
 * Dismiss a proposed goal → won't be re-proposed.
 */
export async function dismissGoalProposal(workspaceId: string, goalId: string) {
	const result = await db
		.update(goals)
		.set({ status: 'dismissed' })
		.where(
			and(eq(goals.id, goalId), eq(goals.workspaceId, workspaceId), eq(goals.status, 'proposed')),
		)
		.returning({ id: goals.id, status: goals.status });
	return result[0] ?? null;
}

/**
 * List proposed goals for a workspace (for surfacing in morning brief / bot).
 */
export async function listProposedGoals(workspaceId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		return db
			.select()
			.from(goals)
			.where(and(eq(goals.workspaceId, workspaceId), eq(goals.status, 'proposed')))
			.orderBy(desc(goals.createdAt))
			.limit(10);
	});
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export interface GoalTypeStats {
	type: string;
	total: number;
	completed: number;
	completionRate: number;
	avgDaysToComplete: number | null;
}

export interface PaceDistribution {
	onTrack: number;
	slightlyBehind: number;
	atRisk: number;
}

export interface GoalAnalytics {
	byType: GoalTypeStats[];
	velocityTrend: number[];
	paceDistribution: PaceDistribution;
}

/**
 * Aggregate goal analytics for a workspace.
 * - Completion rate & avg time-to-completion by type
 * - 14-day velocity trend from progress events
 * - Pace Score distribution for active goals with deadlines
 */
export async function getGoalAnalytics(
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<GoalAnalytics> {
	return withKeys(envelope, async () => {
		// 1. Completion stats by type
		const typeStats = await db
			.select({
				type: goals.type,
				total: count(),
				completed: sql<number>`count(*) filter (where ${goals.status} = 'completed')`,
				avgDays: sql<number | null>`avg(
					extract(epoch from (${goals.completedAt} - ${goals.createdAt})) / 86400
				) filter (where ${goals.status} = 'completed' and ${goals.completedAt} is not null)`,
			})
			.from(goals)
			.where(eq(goals.workspaceId, workspaceId))
			.groupBy(goals.type);

		const byType: GoalTypeStats[] = typeStats.map((row) => ({
			type: row.type,
			total: Number(row.total),
			completed: Number(row.completed),
			completionRate: Number(row.total) > 0 ? Number(row.completed) / Number(row.total) : 0,
			avgDaysToComplete: row.avgDays != null ? Math.round(Number(row.avgDays)) : null,
		}));

		// 2. Velocity trend: aggregate progress events over last 14 days
		const fourteenDaysAgo = new Date();
		fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

		const dailyVelocity = await db
			.select({
				day: sql<string>`date(${goalProgressEvents.createdAt})`,
				total: sql<number>`coalesce(sum(${goalProgressEvents.delta}), 0)`,
			})
			.from(goalProgressEvents)
			.where(
				and(
					eq(goalProgressEvents.workspaceId, workspaceId),
					gte(goalProgressEvents.createdAt, fourteenDaysAgo),
				),
			)
			.groupBy(sql`date(${goalProgressEvents.createdAt})`)
			.orderBy(sql`date(${goalProgressEvents.createdAt})`);

		// Fill in missing days with 0
		const velocityMap = new Map(dailyVelocity.map((r) => [r.day, Number(r.total)]));
		const velocityTrend: number[] = [];
		for (let i = 13; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			const key = d.toISOString().slice(0, 10);
			velocityTrend.push(velocityMap.get(key) ?? 0);
		}

		// 3. Pace Score distribution for active goals with targetDate
		const activeGoals = await db
			.select({
				currentCount: goals.currentCount,
				targetCount: goals.targetCount,
				targetDate: goals.targetDate,
				createdAt: goals.createdAt,
			})
			.from(goals)
			.where(
				and(
					eq(goals.workspaceId, workspaceId),
					eq(goals.status, 'active'),
					sql`${goals.targetDate} is not null`,
				),
			);

		const now = Date.now();
		const paceDistribution: PaceDistribution = { onTrack: 0, slightlyBehind: 0, atRisk: 0 };

		for (const g of activeGoals) {
			if (!g.targetDate || g.targetCount === 0) continue;
			const totalDays =
				(new Date(g.targetDate).getTime() - new Date(g.createdAt).getTime()) / 86400000;
			const daysElapsed = (now - new Date(g.createdAt).getTime()) / 86400000;
			if (totalDays <= 0 || daysElapsed <= 0) continue;

			const pctComplete = g.currentCount / g.targetCount;
			const pctTimeElapsed = Math.min(daysElapsed / totalDays, 1);
			const paceScore = pctComplete / pctTimeElapsed;

			if (paceScore >= 1.0) paceDistribution.onTrack++;
			else if (paceScore >= 0.85) paceDistribution.slightlyBehind++;
			else paceDistribution.atRisk++;
		}

		return { byType, velocityTrend, paceDistribution };
	});
}
