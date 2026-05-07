'use server';

import { workspaceAction } from '@/lib/safe-action';
import { assertWorkspaceOwner } from '@/lib/workspace-authz';
import {
	createCorrectionDiff,
	getReviewQueueStats,
	listPendingExamples,
	promoteToGold,
	rejectExample,
} from '@repo/db';
import type { CreateCorrectionDiffInput } from '@repo/db';
import { z } from 'zod';

/**
 * Classify the diff type by comparing model prediction to corrected output.
 */
function classifyDiffType(
	modelPrediction: unknown,
	correctedOutput: unknown,
): CreateCorrectionDiffInput['diffType'] {
	if (!modelPrediction && correctedOutput) return 'false_negative';
	if (modelPrediction && !correctedOutput) return 'false_positive';

	const pred = modelPrediction as Record<string, unknown> | null;
	const corr = correctedOutput as Record<string, unknown> | null;

	if (pred && corr) {
		if (pred.commitment_type !== corr.commitment_type) return 'wrong_type';
		if (pred.assignee !== corr.assignee) return 'wrong_entity';
		if (pred.due_date !== corr.due_date) return 'wrong_date';
		if (pred.title !== corr.title) return 'hallucination';
	}

	return 'other';
}

export const getReviewQueueStatsAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		await assertWorkspaceOwner(ctx.workspaceId, ctx.session.user.id);
		return getReviewQueueStats(ctx.workspaceId);
	});

export const listPendingExamplesAction = workspaceAction
	.schema(
		z.object({
			featureDomain: z.string().optional(),
			limit: z.number().int().positive().max(100).default(20),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		await assertWorkspaceOwner(ctx.workspaceId, ctx.session.user.id);
		const examples = await listPendingExamples(
			ctx.workspaceId,
			parsedInput.featureDomain,
			parsedInput.limit,
			parsedInput.offset,
		);
		return { examples };
	});

export const promoteToGoldAction = workspaceAction
	.schema(
		z.object({
			goldenId: z.string().uuid(),
			verificationScore: z.number().min(0).max(1).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		await assertWorkspaceOwner(ctx.workspaceId, ctx.session.user.id);
		const result = await promoteToGold(
			parsedInput.goldenId,
			ctx.session.user.id,
			parsedInput.verificationScore,
			ctx.workspaceId,
		);

		// Create correction diff if model prediction differs from corrected output
		if (result && result.modelPrediction !== null && result.correctedOutput !== null) {
			const predStr = JSON.stringify(result.modelPrediction);
			const corrStr = JSON.stringify(result.correctedOutput);
			if (predStr !== corrStr) {
				try {
					// SEC-002: Only structural metadata — no raw prediction/correction content (may contain PII)
					const diffType = classifyDiffType(result.modelPrediction, result.correctedOutput);
					await createCorrectionDiff({
						workspaceId: ctx.workspaceId,
						goldenId: result.id,
						diffType,
						severityScore: 5,
						description: `Human promoted with correction: diffType=${diffType}`,
					});
				} catch (err) {
					console.error('[golden-dataset] Failed to create correction diff on promote:', err);
				}
			}
		}

		return result;
	});

export const rejectExampleAction = workspaceAction
	.schema(
		z.object({
			goldenId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		await assertWorkspaceOwner(ctx.workspaceId, ctx.session.user.id);
		const result = await rejectExample(parsedInput.goldenId, ctx.session.user.id, ctx.workspaceId);

		// Always create a correction diff on rejection — the model was wrong
		if (result) {
			try {
				// SEC-002: Only structural metadata — no raw prediction content (may contain PII)
				await createCorrectionDiff({
					workspaceId: ctx.workspaceId,
					goldenId: result.id,
					diffType: 'false_positive',
					severityScore: 7,
					description: 'Human rejected: model prediction determined incorrect by reviewer',
				});
			} catch (err) {
				console.error('[golden-dataset] Failed to create correction diff on reject:', err);
			}
		}

		return result;
	});
