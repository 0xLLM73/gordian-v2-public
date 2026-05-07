import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { dealCandidates } from '../schema/deal-candidates';

export type DealCandidate = typeof dealCandidates.$inferSelect;

export interface CreateDealCandidateInput {
	sourceMessageId: string;
	chatId: string;
	confidence: number;
	contactId?: string;
	dealTitleGuess: string;
	dealTypeGuess: string;
	signals: Array<{ text: string; tier: number }>;
}

export async function createDealCandidate(
	workspaceId: string,
	input: CreateDealCandidateInput,
	envelope: SealedEnvelope,
): Promise<DealCandidate> {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(dealCandidates)
			.values({
				workspaceId,
				sourceMessageId: input.sourceMessageId,
				chatId: input.chatId,
				confidence: input.confidence,
				contactId: input.contactId,
				dealTitleGuess: input.dealTitleGuess,
				dealTypeGuess: input.dealTypeGuess,
				signals: input.signals,
			})
			.returning();
		const row = result[0];
		if (!row) throw new Error('createDealCandidate: insert returned no rows');
		return row;
	});
}

export async function listPendingCandidates(
	workspaceId: string,
	envelope: SealedEnvelope,
	opts?: { limit?: number; offset?: number },
): Promise<DealCandidate[]> {
	const limit = opts?.limit ?? 50;
	const offset = opts?.offset ?? 0;

	return withKeys(envelope, async () =>
		db
			.select()
			.from(dealCandidates)
			.where(and(eq(dealCandidates.workspaceId, workspaceId), eq(dealCandidates.status, 'pending')))
			.orderBy(desc(dealCandidates.confidence))
			.limit(limit)
			.offset(offset),
	);
}

export async function confirmCandidate(
	workspaceId: string,
	candidateId: string,
	dealId: string,
): Promise<DealCandidate | null> {
	const result = await db
		.update(dealCandidates)
		.set({ status: 'confirmed', confirmedDealId: dealId })
		.where(and(eq(dealCandidates.id, candidateId), eq(dealCandidates.workspaceId, workspaceId)))
		.returning();
	return result[0] ?? null;
}

export async function dismissCandidate(
	workspaceId: string,
	candidateId: string,
): Promise<DealCandidate | null> {
	const result = await db
		.update(dealCandidates)
		.set({ status: 'dismissed', dismissedAt: sql`now()` })
		.where(and(eq(dealCandidates.id, candidateId), eq(dealCandidates.workspaceId, workspaceId)))
		.returning();
	return result[0] ?? null;
}

/**
 * Check if a similar deal candidate already exists for the same contact
 * within a time window. Matches on contactId + overlapping signal text.
 */
export async function isDuplicateCandidate(
	workspaceId: string,
	contactId: string,
	signals: Array<{ text: string; tier: number }>,
	windowDays = 30,
): Promise<boolean> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - windowDays);

	const existing = await db
		.select({ id: dealCandidates.id, signals: dealCandidates.signals })
		.from(dealCandidates)
		.where(
			and(
				eq(dealCandidates.workspaceId, workspaceId),
				eq(dealCandidates.contactId, contactId),
				gte(dealCandidates.createdAt, cutoff),
			),
		);

	const newTexts = new Set(signals.map((s) => s.text));
	for (const row of existing) {
		const existingSignals = row.signals as Array<{ text: string; tier: number }>;
		if (existingSignals.some((s) => newTexts.has(s.text))) {
			return true;
		}
	}
	return false;
}
