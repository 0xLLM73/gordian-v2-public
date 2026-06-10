import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { dealAiRuns } from '../schema/deal-ai-runs';
import { deals } from '../schema/deals';

export type DealAiRunType =
	| 'brief'
	| 'risk'
	| 'next_action'
	| 'follow_up_draft'
	| 'question_answer'
	| 'commitment_suggestion'
	| 'stage_update_suggestion';

export type DealAiRunStatus = 'draft' | 'accepted' | 'dismissed';

export interface SaveDealAiRunInput {
	dealId: string;
	runType: DealAiRunType;
	status?: DealAiRunStatus;
	modelRole: string;
	modelName: string;
	localVendorMode?: 'local' | 'disabled' | 'deterministic_fallback';
	output: string;
	uncertainty?: string | null;
	sourceManifest?: Array<Record<string, unknown>>;
}

async function assertDealInWorkspace(workspaceId: string, dealId: string) {
	const [deal] = await db
		.select({ id: deals.id })
		.from(deals)
		.where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
		.limit(1);

	if (!deal) throw new Error('Not found');
}

export async function saveDealAiRun(
	workspaceId: string,
	input: SaveDealAiRunInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		await assertDealInWorkspace(workspaceId, input.dealId);
		const [result] = await db
			.insert(dealAiRuns)
			.values({
				workspaceId,
				dealId: input.dealId,
				runType: input.runType,
				status: input.status ?? 'draft',
				modelRole: input.modelRole,
				modelName: input.modelName,
				localVendorMode: input.localVendorMode ?? 'local',
				output: input.output,
				uncertainty: input.uncertainty || null,
				sourceManifest: input.sourceManifest ?? [],
			})
			.returning();
		return result ?? null;
	});
}

export async function listDealAiRuns(
	workspaceId: string,
	dealId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		await assertDealInWorkspace(workspaceId, dealId);
		return db
			.select()
			.from(dealAiRuns)
			.where(and(eq(dealAiRuns.workspaceId, workspaceId), eq(dealAiRuns.dealId, dealId)))
			.orderBy(desc(dealAiRuns.createdAt));
	});
}

export async function updateDealAiRunStatus(
	workspaceId: string,
	runId: string,
	status: DealAiRunStatus,
) {
	const [result] = await db
		.update(dealAiRuns)
		.set({
			status,
			acceptedAt: status === 'accepted' ? sql`now()` : undefined,
			dismissedAt: status === 'dismissed' ? sql`now()` : undefined,
			updatedAt: sql`now()`,
		})
		.where(and(eq(dealAiRuns.id, runId), eq(dealAiRuns.workspaceId, workspaceId)))
		.returning({
			id: dealAiRuns.id,
			status: dealAiRuns.status,
			acceptedAt: dealAiRuns.acceptedAt,
			dismissedAt: dealAiRuns.dismissedAt,
		});

	if (!result) throw new Error('Not found');
	return result;
}
