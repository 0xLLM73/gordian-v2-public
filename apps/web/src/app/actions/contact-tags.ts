'use server';

import {
	deleteContactTag as dalDeleteContactTag,
	getContactTag as dalGetContactTag,
	listContactsByTag as dalListContactsByTag,
	upsertContactTag as dalUpsertContactTag,
} from '@repo/db';
import {
	contactPrioritySchema,
	contactRelationshipSchema,
	contactStatusSchema,
} from '@repo/shared';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

export const getContactTagAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return dalGetContactTag(ctx.workspaceId, parsedInput.contactId, ctx.envelope);
	});

export const upsertContactTagAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			relationship: contactRelationshipSchema.optional(),
			priority: contactPrioritySchema.optional(),
			status: contactStatusSchema.optional(),
			customTags: z.array(z.string().max(100)).max(50).optional(),
			goal: z.string().max(500).optional(),
			notes: z.string().max(5000).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const result = await dalUpsertContactTag(ctx.workspaceId, parsedInput, ctx.envelope);

		// DPG Phase 2: Extract rationale when contact prioritized to high (fire-and-forget)
		if (parsedInput.priority === 'high' && ctx.envelope) {
			const { fireRationaleExtraction } = await import('@/lib/rationale-hook');
			fireRationaleExtraction({
				action: 'contact_prioritized',
				label: 'Contact prioritized high', // SEC-PROV-009: structural only
				entityId: parsedInput.contactId,
				entityType: 'contact',
				contactId: parsedInput.contactId,
				workspaceId: ctx.workspaceId,
				envelope: ctx.envelope,
			});
		}

		// Context Graph: Record decision event (fire-and-forget)
		if (ctx.envelope) {
			const { fireDecisionRecording } = await import('@/lib/decision-hook');
			fireDecisionRecording({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				decisionType: 'click',
				label: 'contact-tagged', // SEC-PROV-009: structural only
				entityId: parsedInput.contactId,
				envelope: ctx.envelope,
			});
		}

		return result;
	});

export const listContactsByTagAction = workspaceAction
	.schema(
		z.object({
			relationship: contactRelationshipSchema.optional(),
			priority: contactPrioritySchema.optional(),
			status: contactStatusSchema.optional(),
			limit: z.number().int().positive().optional(),
			offset: z.number().int().nonnegative().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return dalListContactsByTag(ctx.workspaceId, parsedInput, ctx.envelope);
	});

export const deleteContactTagAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalDeleteContactTag(ctx.workspaceId, parsedInput.contactId);
	});
