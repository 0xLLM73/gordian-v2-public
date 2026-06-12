import type { SealedEnvelope } from '@repo/crypto';
import { withKeys } from '@repo/crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { digests } from '../schema/digests';

export interface CreateDigestInput {
	userId: string;
	period: 'today' | 'yesterday' | '3d' | 'week' | 'custom';
	periodStart: Date;
	periodEnd: Date;
}

export async function createDigestPlaceholder(workspaceId: string, input: CreateDigestInput) {
	const result = await db
		.insert(digests)
		.values({
			workspaceId,
			userId: input.userId,
			period: input.period,
			periodStart: input.periodStart,
			periodEnd: input.periodEnd,
			status: 'generating',
		})
		.returning();
	return result[0] ?? null;
}

export async function finalizeDigest(
	workspaceId: string,
	digestId: string,
	data: {
		content: string;
		sections: unknown;
		model: string;
		messageCount: number;
		contactCount: number;
		styleTraceId?: string;
		toneTraceId?: string;
		styleVariant?: string;
		toneVariant?: string;
	},
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.update(digests)
			.set({
				content: data.content,
				sections: data.sections,
				model: data.model,
				messageCount: data.messageCount,
				contactCount: data.contactCount,
				status: 'ready',
				styleTraceId: data.styleTraceId,
				toneTraceId: data.toneTraceId,
				styleVariant: data.styleVariant,
				toneVariant: data.toneVariant,
				generatedAt: new Date(),
			})
			.where(and(eq(digests.id, digestId), eq(digests.workspaceId, workspaceId)))
			.returning();
		return result[0] ?? null;
	});
}

export async function failDigest(workspaceId: string, digestId: string) {
	const result = await db
		.update(digests)
		.set({ status: 'failed' })
		.where(and(eq(digests.id, digestId), eq(digests.workspaceId, workspaceId)))
		.returning();
	return result[0] ?? null;
}

export async function getLatestDigest(
	workspaceId: string,
	userId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const result = await db
			.select()
			.from(digests)
			.where(
				and(
					eq(digests.workspaceId, workspaceId),
					eq(digests.userId, userId),
					eq(digests.status, 'ready'),
				),
			)
			.orderBy(desc(digests.generatedAt))
			.limit(1);
		return result[0] ?? null;
	});
}

export async function listDigests(
	workspaceId: string,
	userId: string,
	envelope: SealedEnvelope,
	options?: { limit?: number },
) {
	const limit = options?.limit ?? 10;
	return withKeys(
		envelope,
		async () =>
			await db
				.select()
				.from(digests)
				.where(
					and(
						eq(digests.workspaceId, workspaceId),
						eq(digests.userId, userId),
						eq(digests.status, 'ready'),
					),
				)
				.orderBy(desc(digests.generatedAt))
				.limit(limit),
	);
}
