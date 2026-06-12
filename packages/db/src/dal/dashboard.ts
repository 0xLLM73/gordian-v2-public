import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { commitments } from '../schema/commitments';
import { contacts } from '../schema/contacts';
import { deals } from '../schema/deals';
import { goals } from '../schema/goals';

export interface DashboardStats {
	contactCount: number;
	activeCommitmentCount: number;
	openDealCount: number;
	totalDealValue: number;
	activeGoalCount: number;
}

export async function getDashboardStats(workspaceId: string): Promise<DashboardStats> {
	const [contactResult, commitmentResult, dealResult, goalResult] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(contacts)
			.where(eq(contacts.workspaceId, workspaceId)),

		db
			.select({ count: sql<number>`count(*)::int` })
			.from(commitments)
			.where(and(eq(commitments.workspaceId, workspaceId), eq(commitments.status, 'active'))),

		db
			.select({
				count: sql<number>`count(*)::int`,
				totalValue: sql<number>`coalesce(sum(${deals.value}), 0)::double precision`,
			})
			.from(deals)
			.where(and(eq(deals.workspaceId, workspaceId), sql`${deals.stage} NOT IN ('won', 'lost')`)),

		db
			.select({ count: sql<number>`count(*)::int` })
			.from(goals)
			.where(and(eq(goals.workspaceId, workspaceId), eq(goals.status, 'active'))),
	]);

	return {
		contactCount: contactResult[0]?.count ?? 0,
		activeCommitmentCount: commitmentResult[0]?.count ?? 0,
		openDealCount: dealResult[0]?.count ?? 0,
		totalDealValue: dealResult[0]?.totalValue ?? 0,
		activeGoalCount: goalResult[0]?.count ?? 0,
	};
}

export interface DashboardAnalyticsStats {
	contactCount: number;
	commitmentCount: number;
	commitmentStatusCounts: Record<string, number>;
}

export async function getDashboardAnalyticsStats(
	workspaceId: string,
): Promise<DashboardAnalyticsStats> {
	const [contactResult, commitmentResult, statusRows] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(contacts)
			.where(eq(contacts.workspaceId, workspaceId)),

		db
			.select({ count: sql<number>`count(*)::int` })
			.from(commitments)
			.where(eq(commitments.workspaceId, workspaceId)),

		db
			.select({
				status: commitments.status,
				count: sql<number>`count(*)::int`,
			})
			.from(commitments)
			.where(eq(commitments.workspaceId, workspaceId))
			.groupBy(commitments.status),
	]);

	return {
		contactCount: contactResult[0]?.count ?? 0,
		commitmentCount: commitmentResult[0]?.count ?? 0,
		commitmentStatusCounts: Object.fromEntries(
			statusRows.map((row) => [row.status, Number(row.count) || 0]),
		),
	};
}

export interface UpcomingCommitment {
	id: string;
	title: string;
	contactId: string;
	commitmentType: string;
	dueDate: Date | null;
	isOverdue: boolean;
}

export async function getUpcomingCommitments(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number },
): Promise<UpcomingCommitment[]> {
	const limit = options?.limit ?? 5;
	const now = new Date();

	return withKeys(envelope, async () => {
		const results = await db
			.select({
				id: commitments.id,
				title: commitments.title,
				contactId: commitments.contactId,
				commitmentType: commitments.commitmentType,
				dueDate: commitments.dueDate,
			})
			.from(commitments)
			.where(and(eq(commitments.workspaceId, workspaceId), eq(commitments.status, 'active')))
			.orderBy(sql`${commitments.dueDate} ASC NULLS LAST`)
			.limit(limit);

		return results.map((r) => ({
			...r,
			isOverdue: r.dueDate !== null && r.dueDate < now,
		}));
	});
}

export interface RecentActivityItem {
	id: string;
	type: 'contact_created' | 'commitment_created' | 'deal_created';
	title: string;
	timestamp: Date;
}

export async function getRecentActivity(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number },
): Promise<RecentActivityItem[]> {
	const limit = options?.limit ?? 10;

	return withKeys(envelope, async () => {
		const [recentContacts, recentCommitments, recentDeals] = await Promise.all([
			db
				.select({
					id: contacts.id,
					firstName: contacts.firstName,
					createdAt: contacts.createdAt,
				})
				.from(contacts)
				.where(eq(contacts.workspaceId, workspaceId))
				.orderBy(sql`${contacts.createdAt} DESC`)
				.limit(limit),

			db
				.select({
					id: commitments.id,
					title: commitments.title,
					createdAt: commitments.createdAt,
				})
				.from(commitments)
				.where(eq(commitments.workspaceId, workspaceId))
				.orderBy(sql`${commitments.createdAt} DESC`)
				.limit(limit),

			db
				.select({
					id: deals.id,
					title: deals.title,
					createdAt: deals.createdAt,
				})
				.from(deals)
				.where(eq(deals.workspaceId, workspaceId))
				.orderBy(sql`${deals.createdAt} DESC`)
				.limit(limit),
		]);

		const items: RecentActivityItem[] = [
			...recentContacts.map((c) => ({
				id: c.id,
				type: 'contact_created' as const,
				title: `New contact: ${c.firstName || 'Unknown'}`,
				timestamp: c.createdAt,
			})),
			...recentCommitments.map((c) => ({
				id: c.id,
				type: 'commitment_created' as const,
				title: `Commitment: ${c.title}`,
				timestamp: c.createdAt,
			})),
			...recentDeals.map((d) => ({
				id: d.id,
				type: 'deal_created' as const,
				title: `Deal: ${d.title}`,
				timestamp: d.createdAt,
			})),
		];

		items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
		return items.slice(0, limit);
	});
}
