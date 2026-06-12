'use server';

import {
	addDealArtifact,
	addDealParticipant,
	createDeal as dalCreate,
	listDeals as dalList,
	updateDeal as dalUpdate,
	getDeal,
	listDealAiRuns,
	listDealArtifacts,
	listDealEvidenceLinks,
	listDealParticipants,
	listDealStageEvents,
	removeDealArtifact,
	removeDealParticipant,
	saveDealAiRun,
	updateDealAiRunStatus,
	updateDealParticipant,
} from '@repo/db';
import {
	buildDealContextPack,
	dealStageSchema,
	dealTermsSchema,
	dealTypeSchema,
	generateDealLocalAiOutput,
	getDealLocalAiStatus,
} from '@repo/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';

const dealSortSchema = z.enum([
	'last_activity',
	'highest_value',
	'newest',
	'oldest',
	'most_stalled',
]);

export const listDealsAction = workspaceAction
	.schema(
		z.object({
			stage: dealStageSchema.optional(),
			limit: z.number().int().positive().optional(),
			offset: z.number().int().nonnegative().optional(),
			sort: dealSortSchema.optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return dalList(ctx.workspaceId, ctx.envelope, {
			stage: parsedInput.stage,
			limit: parsedInput.limit,
			offset: parsedInput.offset,
			sort: parsedInput.sort,
		});
	});

export const createDealAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			title: z.string().trim().min(1).max(200),
			dealType: dealTypeSchema.optional(),
			value: z.number().int().nonnegative(),
			notes: z.string().trim().max(5000).optional(),
			terms: dealTermsSchema.optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const result = await dalCreate(
			ctx.workspaceId,
			{
				contactId: parsedInput.contactId,
				title: parsedInput.title,
				dealType: parsedInput.dealType,
				value: parsedInput.value,
				notes: parsedInput.notes || undefined,
				terms: parsedInput.terms,
			},
			ctx.envelope,
		);
		track(ctx.workspaceId, ctx.session.user.id, 'create_deal', { dealId: result?.id });

		// DPG Phase 2: Extract rationale from message context (fire-and-forget)
		if (result?.id && ctx.envelope) {
			const { fireRationaleExtraction } = await import('@/lib/rationale-hook');
			fireRationaleExtraction({
				action: 'deal_created',
				label: 'Deal created', // SEC-PROV-009: structural only
				entityId: result.id,
				entityType: 'deal',
				contactId: parsedInput.contactId,
				workspaceId: ctx.workspaceId,
				envelope: ctx.envelope,
			});
		}

		return result;
	});

export const updateDealAction = workspaceAction
	.schema(
		z.object({
			dealId: z.string().uuid(),
			title: z.string().trim().min(1).max(200).optional(),
			stage: dealStageSchema.optional(),
			stageNote: z.string().max(500).optional(),
			dealType: dealTypeSchema.optional(),
			value: z.number().int().nonnegative().optional(),
			notes: z.string().trim().max(5000).nullable().optional(),
			terms: dealTermsSchema.optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const result = await dalUpdate(
			ctx.workspaceId,
			parsedInput.dealId,
			{
				title: parsedInput.title,
				stage: parsedInput.stage,
				stageNote: parsedInput.stageNote,
				dealType: parsedInput.dealType,
				value: parsedInput.value,
				notes: parsedInput.notes || parsedInput.notes === null ? parsedInput.notes : undefined,
				terms: parsedInput.terms,
			},
			ctx.envelope,
		);

		// DPG Phase 2: Extract rationale on strategic stage changes (fire-and-forget)
		if (
			parsedInput.stage &&
			['won', 'lost', 'diligence', 'negotiation', 'committed'].includes(parsedInput.stage) &&
			ctx.envelope
		) {
			const { fireRationaleExtraction } = await import('@/lib/rationale-hook');
			fireRationaleExtraction({
				action: `deal_${parsedInput.stage}`,
				label: `Deal stage → ${parsedInput.stage}`, // SEC-PROV-009: structural only
				entityId: parsedInput.dealId,
				entityType: 'deal',
				contactId: result?.contactId,
				workspaceId: ctx.workspaceId,
				envelope: ctx.envelope,
			});
		}

		// Context Graph: Record decision event on stage change (fire-and-forget)
		if (parsedInput.stage && ctx.envelope) {
			const { fireDecisionRecording } = await import('@/lib/decision-hook');
			fireDecisionRecording({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				decisionType: 'purchase',
				label: 'deal-stage-changed', // SEC-PROV-009: structural only
				entityId: parsedInput.dealId,
				envelope: ctx.envelope,
			});
		}

		return result;
	});

export const deleteDealAction = workspaceAction
	.schema(z.object({ dealId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const { deleteDeal } = await import('@repo/db');
		return deleteDeal(ctx.workspaceId, parsedInput.dealId);
	});

// ─── Participants ─────────────────────────────────────────────────────────────

const participantRoleSchema = z.enum([
	'lead',
	'co_investor',
	'advisor',
	'counterparty',
	'introducer',
	'other',
]);

export const listDealParticipantsAction = workspaceAction
	.schema(z.object({ dealId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return listDealParticipants(ctx.workspaceId, parsedInput.dealId, ctx.envelope);
	});

export const addDealParticipantAction = workspaceAction
	.schema(
		z.object({
			dealId: z.string().uuid(),
			contactId: z.string().uuid(),
			role: participantRoleSchema.optional(),
			notes: z.string().max(2000).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return addDealParticipant(ctx.workspaceId, parsedInput, ctx.envelope);
	});

export const removeDealParticipantAction = workspaceAction
	.schema(z.object({ participantId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return removeDealParticipant(ctx.workspaceId, parsedInput.participantId);
	});

export const updateDealParticipantAction = workspaceAction
	.schema(
		z.object({
			participantId: z.string().uuid(),
			role: participantRoleSchema.optional(),
			notes: z.string().max(2000).nullable().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return updateDealParticipant(
			ctx.workspaceId,
			parsedInput.participantId,
			{
				role: parsedInput.role,
				notes: parsedInput.notes,
			},
			ctx.envelope,
		);
	});

// ─── Artifacts ────────────────────────────────────────────────────────────────

const artifactTypeSchema = z.enum([
	'term_sheet',
	'saft',
	'token_warrant',
	'cap_table',
	'contract',
	'presentation',
	'note',
	'other',
]);

export const listDealArtifactsAction = workspaceAction
	.schema(z.object({ dealId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return listDealArtifacts(ctx.workspaceId, parsedInput.dealId, ctx.envelope);
	});

export const addDealArtifactAction = workspaceAction
	.schema(
		z.object({
			dealId: z.string().uuid(),
			title: z.string().trim().min(1).max(200),
			artifactType: artifactTypeSchema.optional(),
			url: z.string().trim().url().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return addDealArtifact(ctx.workspaceId, parsedInput, ctx.envelope);
	});

export const removeDealArtifactAction = workspaceAction
	.schema(z.object({ artifactId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return removeDealArtifact(ctx.workspaceId, parsedInput.artifactId);
	});

// ─── Local Deal AI ──────────────────────────────────────────────────────────

const dealLocalAiRunTypeSchema = z.enum([
	'brief',
	'risk',
	'next_action',
	'follow_up_draft',
	'question_answer',
	'commitment_suggestion',
	'stage_update_suggestion',
]);

function dealAiRunForClient(run: {
	id: string;
	runType: string;
	status: string;
	modelRole: string;
	modelName: string;
	localVendorMode: string;
	output: string;
	uncertainty: string | null;
	sourceManifest?: unknown;
	createdAt?: Date | string;
}) {
	return {
		id: run.id,
		runType: run.runType,
		status: run.status,
		modelRole: run.modelRole,
		modelName: run.modelName,
		localVendorMode: run.localVendorMode,
		output: run.output,
		uncertainty: run.uncertainty,
		sourceCount: Array.isArray(run.sourceManifest) ? run.sourceManifest.length : 0,
		createdAt:
			run.createdAt instanceof Date ? run.createdAt.toISOString() : String(run.createdAt ?? ''),
	};
}

export const getDealLocalAiStatusAction = workspaceAction
	.schema(z.object({ dealId: z.string().uuid() }))
	.action(async () => {
		return getDealLocalAiStatus(process.env);
	});

export const listDealAiRunsAction = workspaceAction
	.schema(z.object({ dealId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return listDealAiRuns(ctx.workspaceId, parsedInput.dealId, ctx.envelope);
	});

export const generateDealLocalAiAction = workspaceAction
	.schema(
		z.object({
			dealId: z.string().uuid(),
			runType: dealLocalAiRunTypeSchema,
			question: z.string().trim().max(500).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const [deal, participants, artifacts, stageEvents, evidenceLinks] = await Promise.all([
			getDeal(ctx.workspaceId, parsedInput.dealId, ctx.envelope),
			listDealParticipants(ctx.workspaceId, parsedInput.dealId, ctx.envelope),
			listDealArtifacts(ctx.workspaceId, parsedInput.dealId, ctx.envelope),
			listDealStageEvents(ctx.workspaceId, parsedInput.dealId, ctx.envelope),
			listDealEvidenceLinks(ctx.workspaceId, parsedInput.dealId, ctx.envelope),
		]);
		if (!deal) throw new Error('Not found');

		const context = buildDealContextPack({
			workspaceId: ctx.workspaceId,
			deal,
			participants,
			artifacts,
			stageEvents,
			evidenceLinks,
		});
		const generated = await generateDealLocalAiOutput(context, parsedInput.runType, {
			question: parsedInput.question,
			allowLiveModel: process.env.DEAL_LOCAL_AI_LIVE_MODEL_ENABLED === 'true',
		});
		const result = await saveDealAiRun(
			ctx.workspaceId,
			{
				dealId: parsedInput.dealId,
				runType: generated.runType,
				status: 'draft',
				modelRole: generated.modelRole,
				modelName: generated.modelName,
				localVendorMode: generated.localVendorMode,
				output: generated.output,
				uncertainty: generated.uncertainty,
				sourceManifest: generated.sourceManifest,
			},
			ctx.envelope,
		);

		revalidatePath(`/deals/${parsedInput.dealId}`);
		if (!result) return null;
		return dealAiRunForClient(result);
	});

export const updateDealAiRunStatusAction = workspaceAction
	.schema(
		z.object({
			runId: z.string().uuid(),
			status: z.enum(['accepted', 'dismissed']),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const result = await updateDealAiRunStatus(
			ctx.workspaceId,
			parsedInput.runId,
			parsedInput.status,
		);
		revalidatePath('/deals');
		return result;
	});
