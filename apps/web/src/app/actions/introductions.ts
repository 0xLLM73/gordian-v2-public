'use server';

import { workspaceAction } from '@/lib/safe-action';
import {
	listIntroductions as dalList,
	updateIntroductionStatus as dalUpdateStatus,
} from '@repo/db';
import { z } from 'zod';

export const listIntroductionsAction = workspaceAction
	.schema(
		z.object({
			status: z.string().optional(),
			limit: z.number().int().positive().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalList(
			ctx.workspaceId,
			{
				status: parsedInput.status,
				limit: parsedInput.limit,
			},
			ctx.envelope,
		);
	});

export const createIntroductionAction = workspaceAction
	.schema(
		z.object({
			introducerContactId: z.string().uuid(),
			introducedContactId1: z.string().uuid(),
			introducedContactId2: z.string().uuid(),
			context: z.enum(['deal', 'hiring', 'knowledge', 'social', 'other']).optional(),
			note: z.string().max(2000).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { createIntroduction } = await import('@repo/db');
		const result = await createIntroduction(
			ctx.workspaceId,
			{
				...parsedInput,
				confidence: 1.0,
			},
			ctx.envelope,
		);

		// DPG Phase 2: Extract rationale from message context (fire-and-forget)
		if (result?.id && ctx.envelope) {
			const { fireRationaleExtraction } = await import('@/lib/rationale-hook');
			fireRationaleExtraction({
				action: 'intro_created',
				label: 'Introduction created', // SEC-PROV-009: structural only
				entityId: result.id,
				entityType: 'introduction',
				contactId: parsedInput.introducerContactId,
				workspaceId: ctx.workspaceId,
				envelope: ctx.envelope,
			});
		}

		// Context Graph: Record decision event (fire-and-forget)
		if (result?.id && ctx.envelope) {
			const { fireDecisionRecording } = await import('@/lib/decision-hook');
			fireDecisionRecording({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				decisionType: 'commitment',
				label: 'introduction-created', // SEC-PROV-009: structural only
				entityId: result.id,
				envelope: ctx.envelope,
			});
		}

		return result;
	});

export const updateIntroductionAction = workspaceAction
	.schema(
		z.object({
			introductionId: z.string().uuid(),
			context: z.enum(['deal', 'hiring', 'knowledge', 'social', 'other']).optional(),
			note: z.string().max(2000).nullable().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { updateIntroduction } = await import('@repo/db');
		return updateIntroduction(
			ctx.workspaceId,
			parsedInput.introductionId,
			{
				context: parsedInput.context,
				note: parsedInput.note,
			},
			ctx.envelope,
		);
	});

export const updateIntroStatusAction = workspaceAction
	.schema(
		z.object({
			introductionId: z.string().uuid(),
			status: z.enum(['triage', 'active', 'archive']),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalUpdateStatus(ctx.workspaceId, parsedInput.introductionId, parsedInput.status);
	});
