import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { commitments } from '../schema/commitments';
import { contacts } from '../schema/contacts';
import { dealArtifacts } from '../schema/deal-artifacts';
import { dealDecisions } from '../schema/deal-decisions';
import { dealEvidenceLinks } from '../schema/deal-evidence-links';
import { dealStageEvents } from '../schema/deal-stage-events';
import { deals } from '../schema/deals';
import { goals } from '../schema/goals';
import { knowledgeEvidence, knowledgeNodes } from '../schema/knowledge';
import { messages } from '../schema/messages';

export type DealEvidenceSourceType =
	| 'deal_artifact'
	| 'deal_stage_event'
	| 'deal_decision'
	| 'knowledge_node'
	| 'knowledge_evidence'
	| 'message'
	| 'contact'
	| 'goal'
	| 'commitment'
	| 'manual_note';

export interface CreateDealStageEventInput {
	dealId: string;
	previousStage?: string | null;
	nextStage: string;
	source?: string;
	actorType?: string;
	note?: string | null;
	idempotencyKey?: string | null;
	occurredAt?: Date;
}

export interface CreateDealDecisionInput {
	dealId: string;
	decisionType?: string;
	sourceType?: string;
	status?: string;
	label: string;
	rationale?: string | null;
	decidedAt?: Date;
}

export interface CreateDealEvidenceLinkInput {
	dealId: string;
	decisionId?: string | null;
	sourceType: DealEvidenceSourceType;
	sourceId?: string | null;
	label?: string | null;
	summary?: string | null;
}

export interface DealDecisionWithEvidence {
	id: string;
	dealId: string;
	decisionType: string;
	sourceType: string;
	status: string;
	label: string;
	rationale: string | null;
	decidedAt: Date;
	evidence: Array<{
		id: string;
		sourceType: string;
		sourceId: string | null;
		label: string | null;
		summary: string | null;
	}>;
}

async function assertDealInWorkspace(workspaceId: string, dealId: string) {
	const [deal] = await db
		.select({ id: deals.id })
		.from(deals)
		.where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
		.limit(1);

	if (!deal) throw new Error('Not found');
}

async function assertDecisionInDeal(workspaceId: string, dealId: string, decisionId: string) {
	const [decision] = await db
		.select({ id: dealDecisions.id })
		.from(dealDecisions)
		.where(
			and(
				eq(dealDecisions.id, decisionId),
				eq(dealDecisions.workspaceId, workspaceId),
				eq(dealDecisions.dealId, dealId),
			),
		)
		.limit(1);

	if (!decision) throw new Error('Not found');
}

async function assertEvidenceSourceInWorkspace(
	workspaceId: string,
	dealId: string,
	sourceType: DealEvidenceSourceType,
	sourceId?: string | null,
) {
	if (sourceType === 'manual_note') return;
	if (!sourceId) throw new Error('Not found');

	const sourceQueries: Record<
		Exclude<DealEvidenceSourceType, 'manual_note'>,
		() => Promise<unknown[]>
	> = {
		deal_artifact: () =>
			db
				.select({ id: dealArtifacts.id })
				.from(dealArtifacts)
				.where(
					and(
						eq(dealArtifacts.id, sourceId),
						eq(dealArtifacts.workspaceId, workspaceId),
						eq(dealArtifacts.dealId, dealId),
					),
				)
				.limit(1),
		deal_stage_event: () =>
			db
				.select({ id: dealStageEvents.id })
				.from(dealStageEvents)
				.where(
					and(
						eq(dealStageEvents.id, sourceId),
						eq(dealStageEvents.workspaceId, workspaceId),
						eq(dealStageEvents.dealId, dealId),
					),
				)
				.limit(1),
		deal_decision: () =>
			db
				.select({ id: dealDecisions.id })
				.from(dealDecisions)
				.where(
					and(
						eq(dealDecisions.id, sourceId),
						eq(dealDecisions.workspaceId, workspaceId),
						eq(dealDecisions.dealId, dealId),
					),
				)
				.limit(1),
		knowledge_node: () =>
			db
				.select({ id: knowledgeNodes.id })
				.from(knowledgeNodes)
				.where(and(eq(knowledgeNodes.id, sourceId), eq(knowledgeNodes.workspaceId, workspaceId)))
				.limit(1),
		knowledge_evidence: () =>
			db
				.select({ id: knowledgeEvidence.id })
				.from(knowledgeEvidence)
				.where(
					and(eq(knowledgeEvidence.id, sourceId), eq(knowledgeEvidence.workspaceId, workspaceId)),
				)
				.limit(1),
		message: () =>
			db
				.select({ id: messages.id })
				.from(messages)
				.where(and(eq(messages.id, sourceId), eq(messages.workspaceId, workspaceId)))
				.limit(1),
		contact: () =>
			db
				.select({ id: contacts.id })
				.from(contacts)
				.where(and(eq(contacts.id, sourceId), eq(contacts.workspaceId, workspaceId)))
				.limit(1),
		goal: () =>
			db
				.select({ id: goals.id })
				.from(goals)
				.where(and(eq(goals.id, sourceId), eq(goals.workspaceId, workspaceId)))
				.limit(1),
		commitment: () =>
			db
				.select({ id: commitments.id })
				.from(commitments)
				.where(and(eq(commitments.id, sourceId), eq(commitments.workspaceId, workspaceId)))
				.limit(1),
	};

	const rows = await sourceQueries[sourceType]();
	if (rows.length === 0) throw new Error('Not found');
}

export async function addDealStageEvent(
	workspaceId: string,
	input: CreateDealStageEventInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		await assertDealInWorkspace(workspaceId, input.dealId);
		const [result] = await db
			.insert(dealStageEvents)
			.values({
				workspaceId,
				dealId: input.dealId,
				previousStage:
					input.previousStage as (typeof dealStageEvents.previousStage.enumValues)[number],
				nextStage: input.nextStage as (typeof dealStageEvents.nextStage.enumValues)[number],
				source: input.source ?? 'manual',
				actorType: input.actorType ?? 'user',
				note: input.note || null,
				idempotencyKey: input.idempotencyKey || null,
				occurredAt: input.occurredAt,
			})
			.returning();
		return result ?? null;
	});
}

export async function listDealStageEvents(
	workspaceId: string,
	dealId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		await assertDealInWorkspace(workspaceId, dealId);
		return db
			.select()
			.from(dealStageEvents)
			.where(and(eq(dealStageEvents.workspaceId, workspaceId), eq(dealStageEvents.dealId, dealId)))
			.orderBy(dealStageEvents.occurredAt);
	});
}

export async function createDealDecision(
	workspaceId: string,
	input: CreateDealDecisionInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		await assertDealInWorkspace(workspaceId, input.dealId);
		const [result] = await db
			.insert(dealDecisions)
			.values({
				workspaceId,
				dealId: input.dealId,
				decisionType: input.decisionType ?? 'manual',
				sourceType: input.sourceType ?? 'manual',
				status: input.status ?? 'accepted',
				label: input.label,
				rationale: input.rationale || null,
				decidedAt: input.decidedAt,
			})
			.returning();
		return result ?? null;
	});
}

export async function linkDealEvidence(
	workspaceId: string,
	input: CreateDealEvidenceLinkInput,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		await assertDealInWorkspace(workspaceId, input.dealId);
		if (input.decisionId) {
			await assertDecisionInDeal(workspaceId, input.dealId, input.decisionId);
		}
		await assertEvidenceSourceInWorkspace(
			workspaceId,
			input.dealId,
			input.sourceType,
			input.sourceId,
		);

		const [result] = await db
			.insert(dealEvidenceLinks)
			.values({
				workspaceId,
				dealId: input.dealId,
				decisionId: input.decisionId || null,
				sourceType: input.sourceType,
				sourceId: input.sourceId || null,
				label: input.label || null,
				summary: input.summary || null,
			})
			.returning();
		return result ?? null;
	});
}

export async function listDealEvidenceLinks(
	workspaceId: string,
	dealId: string,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		await assertDealInWorkspace(workspaceId, dealId);
		return db
			.select()
			.from(dealEvidenceLinks)
			.where(
				and(eq(dealEvidenceLinks.workspaceId, workspaceId), eq(dealEvidenceLinks.dealId, dealId)),
			)
			.orderBy(dealEvidenceLinks.createdAt);
	});
}

export async function listDealDecisionsWithEvidence(
	workspaceId: string,
	dealId: string,
	envelope: SealedEnvelope,
): Promise<DealDecisionWithEvidence[]> {
	return withKeys(envelope, async () => {
		await assertDealInWorkspace(workspaceId, dealId);
		const [decisions, evidence] = await Promise.all([
			db
				.select()
				.from(dealDecisions)
				.where(and(eq(dealDecisions.workspaceId, workspaceId), eq(dealDecisions.dealId, dealId)))
				.orderBy(dealDecisions.decidedAt),
			db
				.select()
				.from(dealEvidenceLinks)
				.where(
					and(eq(dealEvidenceLinks.workspaceId, workspaceId), eq(dealEvidenceLinks.dealId, dealId)),
				)
				.orderBy(dealEvidenceLinks.createdAt),
		]);

		const evidenceByDecision = new Map<string, typeof evidence>();
		for (const link of evidence) {
			if (!link.decisionId) continue;
			const current = evidenceByDecision.get(link.decisionId) ?? [];
			current.push(link);
			evidenceByDecision.set(link.decisionId, current);
		}

		return decisions.map((decision) => ({
			id: decision.id,
			dealId: decision.dealId,
			decisionType: decision.decisionType,
			sourceType: decision.sourceType,
			status: decision.status,
			label: decision.label,
			rationale: decision.rationale,
			decidedAt: decision.decidedAt,
			evidence: (evidenceByDecision.get(decision.id) ?? []).map((link) => ({
				id: link.id,
				sourceType: link.sourceType,
				sourceId: link.sourceId,
				label: link.label,
				summary: link.summary,
			})),
		}));
	});
}

export async function getDealCockpitCounts(workspaceId: string, dealId: string) {
	const [stageEvents, decisions, evidence] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(dealStageEvents)
			.where(and(eq(dealStageEvents.workspaceId, workspaceId), eq(dealStageEvents.dealId, dealId))),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(dealDecisions)
			.where(and(eq(dealDecisions.workspaceId, workspaceId), eq(dealDecisions.dealId, dealId))),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(dealEvidenceLinks)
			.where(
				and(eq(dealEvidenceLinks.workspaceId, workspaceId), eq(dealEvidenceLinks.dealId, dealId)),
			),
	]);

	return {
		stageEvents: stageEvents[0]?.count ?? 0,
		decisions: decisions[0]?.count ?? 0,
		evidence: evidence[0]?.count ?? 0,
	};
}
