import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { dealArtifacts } from '../schema/deal-artifacts';
import { deals } from '../schema/deals';

export interface CreateDealArtifactInput {
	dealId: string;
	title: string;
	artifactType?:
		| 'term_sheet'
		| 'saft'
		| 'token_warrant'
		| 'cap_table'
		| 'contract'
		| 'presentation'
		| 'note'
		| 'other';
	url?: string | null;
	metadata?: Record<string, unknown>;
}

export async function addDealArtifact(
	workspaceId: string,
	input: CreateDealArtifactInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		// SEC-107: Verify dealId belongs to this workspace
		const [deal] = await db
			.select({ id: deals.id })
			.from(deals)
			.where(and(eq(deals.id, input.dealId), eq(deals.workspaceId, workspaceId)))
			.limit(1);

		if (!deal) throw new Error('Not found');

		const [result] = await db
			.insert(dealArtifacts)
			.values({
				workspaceId,
				dealId: input.dealId,
				title: input.title,
				artifactType: input.artifactType ?? 'other',
				url: input.url || null,
				metadata: input.metadata ?? {},
				dataClassification: 'deal_artifact_sensitive',
			})
			.returning();
		return result;
	});
}

export async function listDealArtifacts(
	workspaceId: string,
	dealId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		return db
			.select()
			.from(dealArtifacts)
			.where(and(eq(dealArtifacts.workspaceId, workspaceId), eq(dealArtifacts.dealId, dealId)));
	});
}

export async function removeDealArtifact(workspaceId: string, artifactId: string) {
	return db
		.delete(dealArtifacts)
		.where(and(eq(dealArtifacts.id, artifactId), eq(dealArtifacts.workspaceId, workspaceId)));
}
