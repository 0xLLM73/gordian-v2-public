'use server';

import { actOnRecommendation, dismissRecommendation, getPendingRecommendations } from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

/**
 * Fetch top 3 pending recommendations for the workspace.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getPendingRecommendationsAction = workspaceAction.action(async ({ ctx }) => {
	return await getPendingRecommendations(ctx.workspaceId, 3);
});

/**
 * Mark a recommendation as acted on.
 * Workspace scoping prevents acting on another workspace's recommendations.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const actOnRecommendationAction = workspaceAction
	.schema(z.object({ id: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const result = await actOnRecommendation(parsedInput.id, ctx.workspaceId);

		// DPG Phase 2: Extract rationale from message context (fire-and-forget)
		if (ctx.envelope) {
			const { fireRationaleExtraction } = await import('@/lib/rationale-hook');
			fireRationaleExtraction({
				action: 'recommendation_accepted',
				label: 'Recommendation accepted', // SEC-PROV-009: structural only
				entityId: parsedInput.id,
				entityType: 'recommendation',
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
				label: 'recommendation-accepted', // SEC-PROV-009: structural only
				entityId: parsedInput.id,
				envelope: ctx.envelope,
			});
		}

		return result;
	});

/**
 * Dismiss a recommendation.
 * Workspace scoping prevents dismissing another workspace's recommendations.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const dismissRecommendationAction = workspaceAction
	.schema(z.object({ id: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const result = await dismissRecommendation(parsedInput.id, ctx.workspaceId);

		// DPG Phase 2: Extract rationale from message context (fire-and-forget)
		if (ctx.envelope) {
			const { fireRationaleExtraction } = await import('@/lib/rationale-hook');
			fireRationaleExtraction({
				action: 'recommendation_dismissed',
				label: 'Recommendation dismissed', // SEC-PROV-009: structural only
				entityId: parsedInput.id,
				entityType: 'recommendation',
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
				decisionType: 'dismissal',
				label: 'recommendation-dismissed', // SEC-PROV-009: structural only
				entityId: parsedInput.id,
				envelope: ctx.envelope,
			});
		}

		return result;
	});
