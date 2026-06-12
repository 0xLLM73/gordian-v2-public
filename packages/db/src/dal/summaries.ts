import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { contactSummaries } from '../schema/summaries';

export interface UpsertSummaryInput {
	contactId: string;
	summary: string;
	model: string;
	messageCount: number;
	status: 'generating' | 'ready' | 'stale' | 'failed';
	banditTraceId?: string;
	styleVariant?: string;
}

export async function getLatestSummary(
	workspaceId: string,
	contactId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(contactSummaries)
			.where(
				and(
					eq(contactSummaries.workspaceId, workspaceId),
					eq(contactSummaries.contactId, contactId),
					eq(contactSummaries.status, 'ready'),
				),
			)
			.orderBy(desc(contactSummaries.generatedAt))
			.limit(1);
		return result[0] ?? null;
	});
}

export async function upsertSummary(
	workspaceId: string,
	input: UpsertSummaryInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(contactSummaries)
			.values({
				workspaceId,
				contactId: input.contactId,
				summary: input.summary,
				model: input.model,
				messageCount: input.messageCount,
				status: input.status,
				banditTraceId: input.banditTraceId,
				styleVariant: input.styleVariant,
				generatedAt: new Date(),
			})
			.returning();
		return result[0] ?? null;
	});
}

export async function markSummaryStale(workspaceId: string, contactId: string) {
	return db
		.update(contactSummaries)
		.set({ status: 'stale', updatedAt: sql`now()` })
		.where(
			and(
				eq(contactSummaries.workspaceId, workspaceId),
				eq(contactSummaries.contactId, contactId),
				eq(contactSummaries.status, 'ready'),
			),
		);
}
