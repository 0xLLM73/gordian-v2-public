'use server';

import { workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import {
	addDealArtifact,
	addDealParticipant,
	createDeal as dalCreate,
	listDeals as dalList,
	updateDeal as dalUpdate,
	listDealArtifacts,
	listDealParticipants,
	removeDealArtifact,
	removeDealParticipant,
} from '@repo/db';
import { dealStageSchema, dealTermsSchema, dealTypeSchema } from '@repo/shared';
import { z } from 'zod';

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
			title: z.string().min(1).max(200),
			dealType: dealTypeSchema.optional(),
			value: z.number().int().nonnegative(),
			notes: z.string().max(5000).optional(),
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
				notes: parsedInput.notes,
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
			title: z.string().min(1).max(200).optional(),
			stage: dealStageSchema.optional(),
			stageNote: z.string().max(500).optional(),
			dealType: dealTypeSchema.optional(),
			value: z.number().int().nonnegative().optional(),
			notes: z.string().max(5000).nullable().optional(),
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
				notes: parsedInput.notes,
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
		return listDealArtifacts(ctx.workspaceId, parsedInput.dealId);
	});

export const addDealArtifactAction = workspaceAction
	.schema(
		z.object({
			dealId: z.string().uuid(),
			title: z.string().min(1).max(200),
			artifactType: artifactTypeSchema.optional(),
			url: z.string().url().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return addDealArtifact(ctx.workspaceId, parsedInput);
	});

export const removeDealArtifactAction = workspaceAction
	.schema(z.object({ artifactId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return removeDealArtifact(ctx.workspaceId, parsedInput.artifactId);
	});
