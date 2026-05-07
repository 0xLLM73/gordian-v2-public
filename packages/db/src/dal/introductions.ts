import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '../client';
import { introductions } from '../schema/introductions';

// Valid status transitions map
const VALID_TRANSITIONS: Record<string, string[]> = {
	triage: ['active', 'archive'],
	active: ['archive'],
};

export async function createIntroduction(
	workspaceId: string,
	input: {
		introducerContactId: string;
		introducedContactId1: string;
		introducedContactId2: string;
		context?: string;
		confidence: number;
		note?: string;
		reasoning?: string;
		sourceMessageIds?: string[];
		status?: 'triage' | 'active';
		autoConfirmed?: boolean;
	},
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		// Reject low confidence
		if (input.confidence < 0.3) return null;

		// Dedup: same introducer + same parties within 7 days
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		const existing = await db
			.select({ id: introductions.id })
			.from(introductions)
			.where(
				and(
					eq(introductions.workspaceId, workspaceId),
					eq(introductions.introducerContactId, input.introducerContactId),
					eq(introductions.introducedContactId1, input.introducedContactId1),
					eq(introductions.introducedContactId2, input.introducedContactId2),
					sql`${introductions.detectedAt} > ${sevenDaysAgo.toISOString()}`,
				),
			)
			.limit(1);

		if (existing.length > 0) return null;

		const now = new Date().toISOString();
		const initialStatus = input.status ?? 'triage';
		const result = await db
			.insert(introductions)
			.values({
				workspaceId,
				introducerContactId: input.introducerContactId,
				introducedContactId1: input.introducedContactId1,
				introducedContactId2: input.introducedContactId2,
				context: (input.context as 'deal' | 'hiring' | 'knowledge' | 'social' | 'other') ?? 'other',
				confidence: input.confidence,
				note: input.note,
				reasoning: input.reasoning,
				sourceMessageIds: input.sourceMessageIds,
				status: initialStatus,
				autoConfirmed: input.autoConfirmed ?? false,
				statusHistory: [{ status: initialStatus, timestamp: now }],
			})
			.returning();

		return result[0] ?? null;
	});
}

export async function updateIntroductionStatus(
	workspaceId: string,
	introductionId: string,
	newStatus: string,
) {
	const current = await db
		.select()
		.from(introductions)
		.where(and(eq(introductions.id, introductionId), eq(introductions.workspaceId, workspaceId)))
		.limit(1);

	if (!current[0]) return null;

	const allowed = VALID_TRANSITIONS[current[0].status];
	if (!allowed || !allowed.includes(newStatus)) return null;

	const history = (current[0].statusHistory as Array<Record<string, unknown>>) || [];
	history.push({ status: newStatus, timestamp: new Date().toISOString() });

	// SEC-ENC-504: Only return non-encrypted fields — note is encrypted
	const result = await db
		.update(introductions)
		.set({
			status: newStatus as (typeof introductions.status.enumValues)[number],
			statusHistory: history,
			updatedAt: sql`now()`,
		})
		.where(and(eq(introductions.id, introductionId), eq(introductions.workspaceId, workspaceId)))
		.returning({
			id: introductions.id,
			status: introductions.status,
			statusHistory: introductions.statusHistory,
			updatedAt: introductions.updatedAt,
		});

	return result[0] ?? null;
}

export async function listIntroductions(
	workspaceId: string,
	options: { status?: string; limit?: number; offset?: number } | undefined,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const limit = options?.limit ?? 50;
		const offset = options?.offset ?? 0;
		const conditions = [eq(introductions.workspaceId, workspaceId)];

		if (options?.status) {
			conditions.push(
				eq(
					introductions.status,
					options.status as (typeof introductions.status.enumValues)[number],
				),
			);
		}

		return db
			.select()
			.from(introductions)
			.where(and(...conditions))
			.limit(limit)
			.offset(offset)
			.orderBy(sql`${introductions.detectedAt} desc`);
	});
}

export async function getIntroductionsByIntroducer(
	workspaceId: string,
	introducerContactId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		return db
			.select()
			.from(introductions)
			.where(
				and(
					eq(introductions.workspaceId, workspaceId),
					eq(introductions.introducerContactId, introducerContactId),
				),
			)
			.orderBy(sql`${introductions.detectedAt} desc`);
	});
}

export async function getIntroductionsByContact(
	workspaceId: string,
	contactId: string,
	limit: number,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const { or } = await import('drizzle-orm');
		return db
			.select()
			.from(introductions)
			.where(
				and(
					eq(introductions.workspaceId, workspaceId),
					or(
						eq(introductions.introducerContactId, contactId),
						eq(introductions.introducedContactId1, contactId),
						eq(introductions.introducedContactId2, contactId),
					),
				),
			)
			.limit(limit)
			.orderBy(sql`${introductions.detectedAt} desc`);
	});
}

export async function updateIntroduction(
	workspaceId: string,
	introductionId: string,
	input: { context?: string; note?: string | null },
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const set: Record<string, unknown> = { updatedAt: sql`now()` };
		if (input.context !== undefined)
			set.context = input.context as (typeof introductions.context.enumValues)[number];
		if (input.note !== undefined) set.note = input.note;

		const result = await db
			.update(introductions)
			.set(set)
			.where(and(eq(introductions.id, introductionId), eq(introductions.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

export async function getIntroducerLeaderboard(workspaceId: string, limit = 10) {
	return db
		.select({
			introducerContactId: introductions.introducerContactId,
			count: sql<number>`count(*)::int`,
		})
		.from(introductions)
		.where(and(eq(introductions.workspaceId, workspaceId), ne(introductions.status, 'archive')))
		.groupBy(introductions.introducerContactId)
		.orderBy(sql`count(*) desc`)
		.limit(limit);
}
