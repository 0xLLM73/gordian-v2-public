import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, eq, inArray, sql } from '@repo/db';
import { db } from '../client';
import { contacts } from '../schema/contacts';
import { dealArtifacts } from '../schema/deal-artifacts';
import { dealParticipants } from '../schema/deal-participants';
import { dealStageEvents } from '../schema/deal-stage-events';
import { deals } from '../schema/deals';
import { messages } from '../schema/messages';
import { getActiveGoalsByType, updateGoalProgress } from './goals';

export interface CreateDealInput {
	contactId: string;
	title: string;
	dealType?: string;
	value: number;
	notes?: string;
	source?: string;
	terms?: Record<string, unknown>;
}

export interface UpdateDealInput {
	title?: string;
	stage?: string;
	dealType?: string;
	value?: number;
	notes?: string | null;
	terms?: Record<string, unknown>;
	stageNote?: string;
}

export async function createDeal(
	workspaceId: string,
	input: CreateDealInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(deals)
			.values({
				workspaceId,
				contactId: input.contactId,
				title: input.title,
				titleBlindIndex: input.title,
				value: input.value,
				notes: input.notes,
				dealType: input.dealType as (typeof deals.dealType.enumValues)[number],
				source: input.source as (typeof deals.source.enumValues)[number],
				terms: input.terms ?? {},
				stageHistory: [
					{
						stage: 'discovery',
						timestamp: new Date().toISOString(),
					},
				],
			})
			.returning();
		return result[0] ?? null;
	});
}

export type DealSortOption =
	| 'last_activity'
	| 'highest_value'
	| 'newest'
	| 'oldest'
	| 'most_stalled';

export const DEAL_SORT_OPTIONS = [
	{ value: 'last_activity' as const, label: 'Last activity' },
	{ value: 'highest_value' as const, label: 'Highest value' },
	{ value: 'newest' as const, label: 'Newest' },
	{ value: 'oldest' as const, label: 'Oldest' },
	{ value: 'most_stalled' as const, label: 'Most stalled' },
] as const;

function getSortClause(sort?: DealSortOption) {
	switch (sort) {
		case 'highest_value':
			return sql`${deals.value} desc nulls last`;
		case 'newest':
			return sql`${deals.createdAt} desc`;
		case 'oldest':
			return sql`${deals.createdAt} asc`;
		case 'most_stalled':
			return sql`(stage_history->-1->>'timestamp')::timestamptz asc nulls last`;
		default:
			return sql`(stage_history->-1->>'timestamp')::timestamptz desc nulls last`;
	}
}

export async function listDeals(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { stage?: string; limit?: number; offset?: number; sort?: DealSortOption },
) {
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;

	const conditions = [eq(deals.workspaceId, workspaceId)];

	if (options?.stage) {
		conditions.push(eq(deals.stage, options.stage as (typeof deals.stage.enumValues)[number]));
	}

	return withKeys(envelope, async () => {
		return await db
			.select({
				id: deals.id,
				workspaceId: deals.workspaceId,
				contactId: deals.contactId,
				title: deals.title,
				dealType: deals.dealType,
				stage: deals.stage,
				value: deals.value,
				notes: deals.notes,
				source: deals.source,
				terms: deals.terms,
				stageHistory: deals.stageHistory,
				closedAt: deals.closedAt,
				createdAt: deals.createdAt,
				updatedAt: deals.updatedAt,
				contactFirstName: contacts.firstName,
				contactLastName: contacts.lastName,
			})
			.from(deals)
			.leftJoin(contacts, eq(deals.contactId, contacts.id))
			.where(and(...conditions))
			.limit(limit)
			.offset(offset)
			.orderBy(getSortClause(options?.sort));
	});
}

export async function getDeal(workspaceId: string, dealId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(deals)
			.where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
			.limit(1);
		return result[0] ?? null;
	});
}

export async function updateDeal(
	workspaceId: string,
	dealId: string,
	updates: UpdateDealInput,
	envelope: SealedEnvelope,
) {
	const { stageNote, ...dbUpdates } = updates;
	if (updates.stage) {
		const current = await getDeal(workspaceId, dealId, envelope);
		if (current && current.stage !== updates.stage) {
			const history = (current.stageHistory as Array<Record<string, unknown>>) || [];
			history.push({
				stage: updates.stage,
				timestamp: new Date().toISOString(),
				...(updates.stageNote ? { note: updates.stageNote } : {}),
			});

			const isTerminal = updates.stage === 'won' || updates.stage === 'lost';
			const wasTerminal = current.stage === 'won' || current.stage === 'lost';

			const result = await withKeys(envelope, async () => {
				return await db.transaction(async (tx) => {
					const updated = await tx
						.update(deals)
						.set({
							...dbUpdates,
							stage: updates.stage as (typeof deals.stage.enumValues)[number],
							dealType: updates.dealType as (typeof deals.dealType.enumValues)[number],
							stageHistory: history,
							closedAt: isTerminal ? sql`now()` : wasTerminal ? null : undefined,
							updatedAt: sql`now()`,
							...(updates.title !== undefined ? { titleBlindIndex: updates.title } : {}),
						})
						.where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
						.returning();

					if (updated[0]) {
						await tx.insert(dealStageEvents).values({
							workspaceId,
							dealId,
							previousStage:
								current.stage as (typeof dealStageEvents.previousStage.enumValues)[number],
							nextStage: updates.stage as (typeof dealStageEvents.nextStage.enumValues)[number],
							source: 'manual',
							actorType: 'user',
							note: stageNote || null,
							occurredAt: new Date(),
						});
					}

					return updated;
				});
			});

			// Goal hook: increment business goals when deal reaches committed or won
			if (updates.stage === 'committed' || updates.stage === 'won') {
				try {
					const bizGoals = await getActiveGoalsByType(workspaceId, 'business', undefined, envelope);
					for (const goal of bizGoals) {
						await updateGoalProgress(workspaceId, goal.id, 1, 'business');
					}
				} catch {}
			}

			return result[0] ?? null;
		}
	}

	return withKeys(envelope, async () => {
		const result = await db
			.update(deals)
			.set({
				...updates,
				stage: updates.stage as (typeof deals.stage.enumValues)[number],
				dealType: updates.dealType as (typeof deals.dealType.enumValues)[number],
				updatedAt: sql`now()`,
				...(updates.title !== undefined ? { titleBlindIndex: updates.title } : {}),
			})
			.where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

export async function getDealsByContact(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		return await db
			.select({
				id: deals.id,
				contactId: deals.contactId,
				title: deals.title,
				dealType: deals.dealType,
				stage: deals.stage,
				value: deals.value,
				notes: deals.notes,
				source: deals.source,
				terms: deals.terms,
				stageHistory: deals.stageHistory,
				closedAt: deals.closedAt,
				createdAt: deals.createdAt,
				updatedAt: deals.updatedAt,
				contactFirstName: contacts.firstName,
				contactLastName: contacts.lastName,
			})
			.from(deals)
			.leftJoin(contacts, eq(deals.contactId, contacts.id))
			.where(and(eq(deals.workspaceId, workspaceId), eq(deals.contactId, contactId)))
			.orderBy(sql`${deals.createdAt} desc`);
	});
}

export async function deleteDeal(workspaceId: string, dealId: string) {
	const result = await db
		.delete(deals)
		.where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
		.returning({ id: deals.id });
	return result[0] ?? null;
}

export interface StageVelocityStats {
	avgDaysPerStage: Record<string, number>;
	conversionRates: Record<string, number>;
}

const PIPELINE_STAGES = ['discovery', 'diligence', 'negotiation', 'committed', 'won'] as const;

/** Compute avg days per stage + conversion rates from all workspace deals */
export async function getStageVelocityStats(workspaceId: string): Promise<StageVelocityStats> {
	const result = await db
		.select({ stageHistory: deals.stageHistory })
		.from(deals)
		.where(eq(deals.workspaceId, workspaceId));

	const stageDurations: Record<string, number[]> = {};
	const stageEntryCount: Record<string, number> = {};
	const stageAdvanceCount: Record<string, number> = {};

	const pipelineIndex = new Map<string, number>(PIPELINE_STAGES.map((s, i) => [s, i]));

	for (const deal of result) {
		const history = (deal.stageHistory as Array<{ stage: string; timestamp: string }>) || [];
		for (let i = 0; i < history.length; i++) {
			const entry = history[i];
			const stage = entry.stage;
			stageEntryCount[stage] = (stageEntryCount[stage] || 0) + 1;

			if (i < history.length - 1) {
				const next = history[i + 1];
				const days =
					(new Date(next.timestamp).getTime() - new Date(entry.timestamp).getTime()) /
					(1000 * 60 * 60 * 24);
				if (!stageDurations[stage]) stageDurations[stage] = [];
				stageDurations[stage].push(Math.max(0, days));

				const curIdx = pipelineIndex.get(stage);
				const nextIdx = pipelineIndex.get(next.stage);
				if (curIdx !== undefined && nextIdx !== undefined && nextIdx > curIdx) {
					stageAdvanceCount[stage] = (stageAdvanceCount[stage] || 0) + 1;
				}
			}
		}
	}

	const avgDaysPerStage: Record<string, number> = {};
	for (const [stage, durations] of Object.entries(stageDurations)) {
		avgDaysPerStage[stage] = durations.reduce((a, b) => a + b, 0) / durations.length;
	}

	const conversionRates: Record<string, number> = {};
	for (const stage of PIPELINE_STAGES) {
		const entries = stageEntryCount[stage] || 0;
		if (entries > 0) {
			conversionRates[stage] = Math.round(((stageAdvanceCount[stage] || 0) / entries) * 100);
		}
	}

	return { avgDaysPerStage, conversionRates };
}

// ─── Deal Confidence Badges ─────────────────────────────────────────────────

export type DealConfidenceBadge = 'hot' | 'active' | 'at_risk' | 'stalled';

export interface DealConfidenceResult {
	dealId: string;
	badge: DealConfidenceBadge;
	score: number;
	signals: {
		stageVelocity: number;
		messageRecency: number;
		participantCount: number;
		artifactCount: number;
		messageTrend: number;
	};
}

const CONFIDENCE_WEIGHTS = {
	stageVelocity: 0.4,
	messageRecency: 0.2,
	participantCount: 0.15,
	artifactCount: 0.1,
	messageTrend: 0.15,
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function scoreStageVelocity(daysInStage: number, avgDays: number | undefined): number {
	if (avgDays === undefined || avgDays <= 0) return 0.5;
	const ratio = daysInStage / avgDays;
	if (ratio <= 0.5) return 1.0;
	if (ratio <= 1.0) return 1.0 - (ratio - 0.5) * 0.8;
	if (ratio <= 2.0) return 0.6 - (ratio - 1.0) * 0.4;
	return 0.0;
}

function scoreMessageRecency(daysSince: number | null): number {
	if (daysSince === null) return 0.0;
	if (daysSince <= 3) return 1.0;
	if (daysSince <= 7) return 0.8;
	if (daysSince <= 14) return 0.5;
	if (daysSince <= 30) return 0.2;
	return 0.0;
}

function scoreParticipantCount(count: number): number {
	if (count >= 3) return 1.0;
	if (count === 2) return 0.7;
	if (count === 1) return 0.4;
	return 0.1;
}

function scoreArtifactCount(count: number): number {
	if (count >= 3) return 1.0;
	if (count === 2) return 0.7;
	if (count === 1) return 0.4;
	return 0.0;
}

function scoreMessageTrend(recent: number, older: number): number {
	const ratio = recent / Math.max(older, 1);
	if (ratio >= 2.0) return 1.0;
	if (ratio >= 1.0) return 0.7;
	if (ratio >= 0.5) return 0.4;
	return 0.1;
}

function badgeFromScore(score: number): DealConfidenceBadge {
	if (score >= 0.75) return 'hot';
	if (score >= 0.5) return 'active';
	if (score >= 0.25) return 'at_risk';
	return 'stalled';
}

/** Batch-fetch last message date per contact */
async function getLastMessageDates(
	workspaceId: string,
	contactIds: string[],
): Promise<Map<string, Date>> {
	if (contactIds.length === 0) return new Map();
	const rows = await db
		.select({
			contactId: messages.contactId,
			lastSentAt: sql<string>`max(${messages.sentAt})`,
		})
		.from(messages)
		.where(and(eq(messages.workspaceId, workspaceId), inArray(messages.contactId, contactIds)))
		.groupBy(messages.contactId);
	const map = new Map<string, Date>();
	for (const row of rows) {
		if (row.contactId && row.lastSentAt) map.set(row.contactId, new Date(row.lastSentAt));
	}
	return map;
}

/** Batch-fetch message volume trend (14d recent vs 14-42d older) per contact */
async function getMessageTrends(
	workspaceId: string,
	contactIds: string[],
): Promise<Map<string, { recent: number; older: number }>> {
	if (contactIds.length === 0) return new Map();
	const rows = await db
		.select({
			contactId: messages.contactId,
			recent: sql<number>`count(*) filter (where ${messages.sentAt} >= now() - interval '14 days')::int`,
			older: sql<number>`count(*) filter (where ${messages.sentAt} >= now() - interval '42 days' and ${messages.sentAt} < now() - interval '14 days')::int`,
		})
		.from(messages)
		.where(
			and(
				eq(messages.workspaceId, workspaceId),
				inArray(messages.contactId, contactIds),
				sql`${messages.sentAt} >= now() - interval '42 days'`,
			),
		)
		.groupBy(messages.contactId);
	const map = new Map<string, { recent: number; older: number }>();
	for (const row of rows) {
		if (row.contactId) map.set(row.contactId, { recent: row.recent, older: row.older });
	}
	return map;
}

/** Batch-fetch participant counts per deal */
async function getParticipantCounts(
	workspaceId: string,
	dealIds: string[],
): Promise<Map<string, number>> {
	if (dealIds.length === 0) return new Map();
	const rows = await db
		.select({
			dealId: dealParticipants.dealId,
			count: sql<number>`count(*)::int`,
		})
		.from(dealParticipants)
		.where(
			and(eq(dealParticipants.workspaceId, workspaceId), inArray(dealParticipants.dealId, dealIds)),
		)
		.groupBy(dealParticipants.dealId);
	const map = new Map<string, number>();
	for (const row of rows) {
		map.set(row.dealId, row.count);
	}
	return map;
}

/** Batch-fetch artifact counts per deal */
async function getArtifactCounts(
	workspaceId: string,
	dealIds: string[],
): Promise<Map<string, number>> {
	if (dealIds.length === 0) return new Map();
	const rows = await db
		.select({
			dealId: dealArtifacts.dealId,
			count: sql<number>`count(*)::int`,
		})
		.from(dealArtifacts)
		.where(and(eq(dealArtifacts.workspaceId, workspaceId), inArray(dealArtifacts.dealId, dealIds)))
		.groupBy(dealArtifacts.dealId);
	const map = new Map<string, number>();
	for (const row of rows) {
		map.set(row.dealId, row.count);
	}
	return map;
}

/** Compute confidence badges for a list of deals */
export async function computeDealConfidence(
	workspaceId: string,
	dealsList: Array<{
		id: string;
		contactId: string;
		stage: string;
		stageHistory: unknown;
	}>,
): Promise<DealConfidenceResult[]> {
	const activeDeals = dealsList.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
	if (activeDeals.length === 0) return [];

	const dealIds = activeDeals.map((d) => d.id);
	const contactIds = [...new Set(activeDeals.map((d) => d.contactId))];

	const [velocityStats, lastMessages, trends, participants, artifacts] = await Promise.all([
		getStageVelocityStats(workspaceId),
		getLastMessageDates(workspaceId, contactIds),
		getMessageTrends(workspaceId, contactIds),
		getParticipantCounts(workspaceId, dealIds),
		getArtifactCounts(workspaceId, dealIds),
	]);

	const now = Date.now();

	return activeDeals.map((deal) => {
		const history = (deal.stageHistory as Array<{ stage: string; timestamp: string }>) || [];
		const lastEntry = history[history.length - 1];
		const daysInStage = lastEntry
			? (now - new Date(lastEntry.timestamp).getTime()) / MS_PER_DAY
			: 0;

		const stageVelocity = scoreStageVelocity(
			daysInStage,
			velocityStats.avgDaysPerStage[deal.stage],
		);

		const lastMsg = lastMessages.get(deal.contactId);
		const daysSinceMsg = lastMsg ? (now - lastMsg.getTime()) / MS_PER_DAY : null;
		const messageRecency = scoreMessageRecency(daysSinceMsg);

		const participantCount = scoreParticipantCount(participants.get(deal.id) ?? 0);
		const artifactCount = scoreArtifactCount(artifacts.get(deal.id) ?? 0);

		const trend = trends.get(deal.contactId) ?? { recent: 0, older: 0 };
		const messageTrend = scoreMessageTrend(trend.recent, trend.older);

		const score =
			CONFIDENCE_WEIGHTS.stageVelocity * stageVelocity +
			CONFIDENCE_WEIGHTS.messageRecency * messageRecency +
			CONFIDENCE_WEIGHTS.participantCount * participantCount +
			CONFIDENCE_WEIGHTS.artifactCount * artifactCount +
			CONFIDENCE_WEIGHTS.messageTrend * messageTrend;

		return {
			dealId: deal.id,
			badge: badgeFromScore(score),
			score: Math.round(score * 100) / 100,
			signals: {
				stageVelocity: Math.round(stageVelocity * 100) / 100,
				messageRecency: Math.round(messageRecency * 100) / 100,
				participantCount: Math.round(participantCount * 100) / 100,
				artifactCount: Math.round(artifactCount * 100) / 100,
				messageTrend: Math.round(messageTrend * 100) / 100,
			},
		};
	});
}

/** Aggregate deal counts by stage for dashboard */
export async function getDealStageCounts(workspaceId: string) {
	const result = await db
		.select({
			stage: deals.stage,
			count: sql<number>`count(*)::int`,
			totalValue: sql<number>`coalesce(sum(${deals.value}), 0)::double precision`,
		})
		.from(deals)
		.where(eq(deals.workspaceId, workspaceId))
		.groupBy(deals.stage);
	return result;
}
