import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { commitments } from '../schema/commitments';
import { contacts } from '../schema/contacts';

// ─── Fulfillment Detection DAL ───────────────────────────────────────────────

export async function getCommitmentsForFulfillmentCheck(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		return await db
			.select()
			.from(commitments)
			.where(
				and(
					eq(commitments.workspaceId, workspaceId),
					eq(commitments.contactId, contactId),
					eq(commitments.status, 'active'),
				),
			)
			.orderBy(commitments.createdAt)
			.limit(20);
	});
}

export async function markCommitmentFulfilled(
	workspaceId: string,
	commitmentId: string,
	evidence: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.update(commitments)
			.set({
				status: 'completed',
				fulfillmentEvidence: evidence,
				fulfilledAt: new Date(),
				lastCheckedAt: new Date(),
				updatedAt: sql`now()`,
			})
			.where(and(eq(commitments.id, commitmentId), eq(commitments.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

export async function updateLastCheckedAt(workspaceId: string, commitmentIds: string[]) {
	if (commitmentIds.length === 0) return;

	await db
		.update(commitments)
		.set({ lastCheckedAt: new Date(), updatedAt: sql`now()` })
		.where(and(eq(commitments.workspaceId, workspaceId), inArray(commitments.id, commitmentIds)));
}

// ─── Core Commitment DAL ─────────────────────────────────────────────────────

export interface CreateCommitmentInput {
	contactId: string;
	title: string;
	commitmentType: 'promise' | 'task' | 'meeting' | 'financial';
	assignee: string;
	confidence: number;
	dueDate?: Date;
	quote?: string;
	sourceMessageIds?: string[];
	extractionContext?: string;
	embedding?: number[];
	sourceMessageAgeDays?: number;
	banditTraceId?: string;
	status?: 'active' | 'draft' | 'dismissed';
}

export async function createCommitment(
	workspaceId: string,
	input: CreateCommitmentInput,
	envelope: SealedEnvelope,
) {
	// Confidence routing (dual-loop calibrated):
	// > 0.85: Auto-confirm (status: 'active')
	// 0.4-0.85: Draft mode (status: 'draft', shown in review queue)
	// < 0.4: Discard (logged for analytics only)
	let status: 'active' | 'draft' | 'dismissed' = input.status ?? 'draft';
	if (!input.status) {
		if (input.confidence > 0.85) status = 'active';
		if (input.confidence < 0.4) status = 'dismissed';
	}

	return withKeys(envelope, async () => {
		const ownedContact = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.id, input.contactId), eq(contacts.workspaceId, workspaceId)))
			.limit(1);

		if (ownedContact.length === 0) return null;

		const result = await db
			.insert(commitments)
			.values({
				workspaceId,
				contactId: input.contactId,
				title: input.title,
				commitmentType: input.commitmentType,
				status,
				assignee: input.assignee,
				confidence: input.confidence,
				dueDate: input.dueDate,
				quote: input.quote,
				sourceMessageIds: input.sourceMessageIds,
				extractionContext: input.extractionContext,
				embedding: input.embedding,
				sourceMessageAgeDays: input.sourceMessageAgeDays,
				banditTraceId: input.banditTraceId,
			})
			.returning();
		return result[0] ?? null;
	});
}

export async function getCommitmentsByContact(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
	options?: { status?: string; limit?: number },
) {
	const limit = options?.limit ?? 50;

	return withKeys(envelope, async () => {
		const conditions = [
			eq(commitments.workspaceId, workspaceId),
			eq(commitments.contactId, contactId),
		];

		if (options?.status) {
			conditions.push(
				eq(commitments.status, options.status as (typeof commitments.status.enumValues)[number]),
			);
		}

		return await db
			.select({
				id: commitments.id,
				workspaceId: commitments.workspaceId,
				contactId: commitments.contactId,
				title: commitments.title,
				commitmentType: commitments.commitmentType,
				status: commitments.status,
				assignee: commitments.assignee,
				confidence: commitments.confidence,
				dueDate: commitments.dueDate,
				quote: commitments.quote,
				fulfilledAt: commitments.fulfilledAt,
				snoozedUntil: commitments.snoozedUntil,
				createdAt: commitments.createdAt,
				updatedAt: commitments.updatedAt,
				contactFirstName: contacts.firstName,
				contactLastName: contacts.lastName,
			})
			.from(commitments)
			.leftJoin(contacts, eq(commitments.contactId, contacts.id))
			.where(and(...conditions))
			.limit(limit)
			.orderBy(commitments.createdAt);
	});
}

export async function updateCommitmentStatus(
	workspaceId: string,
	commitmentId: string,
	status: 'active' | 'completed' | 'dismissed' | 'draft',
) {
	const result = await db
		.update(commitments)
		.set({ status, updatedAt: sql`now()` })
		.where(and(eq(commitments.id, commitmentId), eq(commitments.workspaceId, workspaceId)))
		.returning();
	return result[0] ?? null;
}

export async function getActiveCommitments(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number },
) {
	const limit = options?.limit ?? 50;

	return withKeys(envelope, async () => {
		return await db
			.select({
				id: commitments.id,
				workspaceId: commitments.workspaceId,
				contactId: commitments.contactId,
				title: commitments.title,
				commitmentType: commitments.commitmentType,
				status: commitments.status,
				assignee: commitments.assignee,
				confidence: commitments.confidence,
				dueDate: commitments.dueDate,
				quote: commitments.quote,
				fulfilledAt: commitments.fulfilledAt,
				snoozedUntil: commitments.snoozedUntil,
				createdAt: commitments.createdAt,
				updatedAt: commitments.updatedAt,
				contactFirstName: contacts.firstName,
				contactLastName: contacts.lastName,
			})
			.from(commitments)
			.leftJoin(contacts, eq(commitments.contactId, contacts.id))
			.where(and(eq(commitments.workspaceId, workspaceId), eq(commitments.status, 'active')))
			.limit(limit)
			.orderBy(commitments.dueDate);
	});
}

export async function getCommitmentsByWorkspace(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { status?: string; limit?: number },
) {
	const limit = options?.limit ?? 50;

	return withKeys(envelope, async () => {
		const conditions = [eq(commitments.workspaceId, workspaceId)];
		const now = new Date();

		if (options?.status === 'snoozed') {
			// Snoozed = active items with snoozedUntil in the future
			conditions.push(eq(commitments.status, 'active'));
			conditions.push(gt(commitments.snoozedUntil, now));
		} else if (options?.status === 'active') {
			// Active = active items NOT currently snoozed
			conditions.push(eq(commitments.status, 'active'));
			const notSnoozed = or(isNull(commitments.snoozedUntil), lte(commitments.snoozedUntil, now));
			if (notSnoozed) conditions.push(notSnoozed);
		} else if (options?.status && options.status !== 'all') {
			conditions.push(
				eq(commitments.status, options.status as (typeof commitments.status.enumValues)[number]),
			);
		}

		return await db
			.select({
				id: commitments.id,
				workspaceId: commitments.workspaceId,
				contactId: commitments.contactId,
				title: commitments.title,
				commitmentType: commitments.commitmentType,
				status: commitments.status,
				assignee: commitments.assignee,
				confidence: commitments.confidence,
				dueDate: commitments.dueDate,
				quote: commitments.quote,
				sourceMessageIds: commitments.sourceMessageIds,
				extractionContext: commitments.extractionContext,
				embedding: commitments.embedding,
				banditTraceId: commitments.banditTraceId,
				fulfillmentEvidence: commitments.fulfillmentEvidence,
				lastCheckedAt: commitments.lastCheckedAt,
				fulfilledAt: commitments.fulfilledAt,
				snoozedUntil: commitments.snoozedUntil,
				createdAt: commitments.createdAt,
				updatedAt: commitments.updatedAt,
				contactFirstName: contacts.firstName,
				contactLastName: contacts.lastName,
			})
			.from(commitments)
			.leftJoin(contacts, eq(commitments.contactId, contacts.id))
			.where(and(...conditions))
			.limit(limit)
			.orderBy(
				sql`CASE WHEN ${commitments.dueDate} IS NULL THEN 1 ELSE 0 END`,
				commitments.dueDate,
				sql`${commitments.confidence} DESC`,
				sql`CASE WHEN ${commitments.sourceMessageAgeDays} IS NULL THEN 1 ELSE 0 END`,
				commitments.sourceMessageAgeDays,
				sql`${commitments.createdAt} DESC`,
			);
	});
}

export async function snoozeCommitment(
	workspaceId: string,
	commitmentId: string,
	snoozedUntil: Date,
) {
	const result = await db
		.update(commitments)
		.set({ snoozedUntil, updatedAt: sql`now()` })
		.where(
			and(
				eq(commitments.id, commitmentId),
				eq(commitments.workspaceId, workspaceId),
				eq(commitments.status, 'active'),
			),
		)
		.returning();
	return result[0] ?? null;
}

/**
 * Get the bandit trace ID for a commitment (for feedback signal routing).
 */
export async function getCommitmentBanditTrace(workspaceId: string, commitmentId: string) {
	const result = await db
		.select({ banditTraceId: commitments.banditTraceId })
		.from(commitments)
		.where(and(eq(commitments.id, commitmentId), eq(commitments.workspaceId, workspaceId)))
		.limit(1);
	return result[0]?.banditTraceId ?? null;
}

/**
 * Get a single commitment with decrypted fields for feedback/golden-dataset creation.
 */
export async function getCommitmentForFeedback(
	workspaceId: string,
	commitmentId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(commitments)
			.where(and(eq(commitments.id, commitmentId), eq(commitments.workspaceId, workspaceId)))
			.limit(1);
		return result[0] ?? null;
	});
}

/**
 * Get recent, high-confidence commitments for the First Look onboarding page.
 * Filters to commitments from messages <= 7 days old, ordered by confidence DESC then age ASC.
 */
export async function getCommitmentsForFirstLook(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { maxAgeDays?: number; limit?: number },
) {
	const maxAge = options?.maxAgeDays ?? 7;
	const limit = options?.limit ?? 10;

	return withKeys(envelope, async () => {
		return db
			.select({
				id: commitments.id,
				contactId: commitments.contactId,
				title: commitments.title,
				commitmentType: commitments.commitmentType,
				status: commitments.status,
				assignee: commitments.assignee,
				confidence: commitments.confidence,
				dueDate: commitments.dueDate,
				quote: commitments.quote,
				sourceMessageAgeDays: commitments.sourceMessageAgeDays,
				createdAt: commitments.createdAt,
				contactFirstName: contacts.firstName,
				contactLastName: contacts.lastName,
			})
			.from(commitments)
			.leftJoin(contacts, eq(commitments.contactId, contacts.id))
			.where(
				and(
					eq(commitments.workspaceId, workspaceId),
					sql`${commitments.status} IN ('active', 'draft')`,
					sql`${commitments.sourceMessageAgeDays} IS NOT NULL AND ${commitments.sourceMessageAgeDays} <= ${maxAge}`,
				),
			)
			.orderBy(sql`${commitments.confidence} DESC, ${commitments.sourceMessageAgeDays} ASC`)
			.limit(limit);
	});
}
