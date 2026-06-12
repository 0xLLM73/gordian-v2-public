import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { briefs } from '../schema/briefs';

export interface SaveBriefInput {
	text: string;
	toneTraceId: string;
	detailTraceId: string;
	toneVariant: string;
	detailVariant: string;
}

export async function saveBrief(
	workspaceId: string,
	userId: string,
	result: SaveBriefInput,
	envelope: SealedEnvelope,
): Promise<string> {
	return withKeys(envelope, async () => {
		const rows = await db
			.insert(briefs)
			.values({
				workspaceId,
				userId,
				content: result.text,
				toneTraceId: result.toneTraceId,
				detailTraceId: result.detailTraceId,
				toneVariant: result.toneVariant,
				detailVariant: result.detailVariant,
			})
			.returning({ id: briefs.id });
		const row = rows[0];
		if (!row) throw new Error('Failed to insert brief');
		return row.id;
	});
}

export interface LatestBrief {
	id: string;
	content: string | null;
	toneTraceId: string | null;
	detailTraceId: string | null;
	toneVariant: string | null;
	detailVariant: string | null;
	feedback: boolean | null;
	generatedAt: Date;
}

export async function updateBriefFeedback(
	briefId: string,
	workspaceId: string,
	feedback: boolean,
): Promise<void> {
	await db
		.update(briefs)
		.set({ feedback, feedbackAt: new Date() })
		.where(and(eq(briefs.id, briefId), eq(briefs.workspaceId, workspaceId)));
}

export async function getLatestBrief(
	workspaceId: string,
	userId: string,
	envelope: SealedEnvelope,
): Promise<LatestBrief | null> {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(briefs)
			.where(and(eq(briefs.workspaceId, workspaceId), eq(briefs.userId, userId)))
			.orderBy(desc(briefs.generatedAt))
			.limit(1);
		const row = result[0];
		if (!row) return null;
		return {
			id: row.id,
			content: row.content,
			toneTraceId: row.toneTraceId,
			detailTraceId: row.detailTraceId,
			toneVariant: row.toneVariant,
			detailVariant: row.detailVariant,
			feedback: row.feedback,
			generatedAt: row.generatedAt,
		};
	});
}
