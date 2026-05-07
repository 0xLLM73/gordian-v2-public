import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { draftLogs } from '../schema/drafts';

export async function createDraftLog(
	workspaceId: string,
	contactId: string,
	armType: 'casual_nudge' | 'professional_value' | 'direct_ask' | 'soft_memory',
	generatedText: string,
	envelope: SealedEnvelope,
	styleProfileVersion?: number | null,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.insert(draftLogs)
			.values({
				workspaceId,
				contactId,
				armType,
				generatedText,
				styleProfileVersion: styleProfileVersion ?? null,
			})
			.returning();
		return result[0] ?? null;
	});
}

export async function getDraftLog(workspaceId: string, draftId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(draftLogs)
			.where(and(eq(draftLogs.id, draftId), eq(draftLogs.workspaceId, workspaceId)))
			.limit(1);
		return result[0] ?? null;
	});
}

export async function markDraftSent(
	workspaceId: string,
	draftId: string,
	editedText: string | null,
	editDistance: number | null,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.update(draftLogs)
			.set({ wasSent: true, editedText, editDistance, sentAt: new Date() })
			.where(and(eq(draftLogs.id, draftId), eq(draftLogs.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

export async function markDraftDiscarded(workspaceId: string, draftId: string) {
	const result = await db
		.update(draftLogs)
		.set({ wasDiscarded: true })
		.where(and(eq(draftLogs.id, draftId), eq(draftLogs.workspaceId, workspaceId)))
		.returning();
	return result[0] ?? null;
}

export async function getPendingDrafts(
	workspaceId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number },
) {
	const limit = options?.limit ?? 10;
	return withKeys(envelope, async () => {
		return await db
			.select({
				id: draftLogs.id,
				contactId: draftLogs.contactId,
				armType: draftLogs.armType,
				generatedText: draftLogs.generatedText,
				createdAt: draftLogs.createdAt,
			})
			.from(draftLogs)
			.where(
				and(
					eq(draftLogs.workspaceId, workspaceId),
					eq(draftLogs.wasSent, false),
					eq(draftLogs.wasDiscarded, false),
				),
			)
			.orderBy(sql`${draftLogs.createdAt} desc`)
			.limit(limit);
	});
}

export async function getDraftStats(workspaceId: string) {
	return db
		.select({
			armType: draftLogs.armType,
			total: sql<number>`count(*)::int`,
			sent: sql<number>`count(*) filter (where ${draftLogs.wasSent})::int`,
			discarded: sql<number>`count(*) filter (where ${draftLogs.wasDiscarded})::int`,
			avgEditDistance: sql<number>`avg(${draftLogs.editDistance})::int`,
		})
		.from(draftLogs)
		.where(eq(draftLogs.workspaceId, workspaceId))
		.groupBy(draftLogs.armType);
}
