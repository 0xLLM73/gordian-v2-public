'use server';

import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import { getLatestBrief, updateBriefFeedback } from '@repo/db';
import { z } from 'zod';

export const getLatestBriefAction = workspaceAction.schema(z.object({})).action(async ({ ctx }) => {
	return getLatestBrief(ctx.workspaceId, ctx.session.user.id, ctx.envelope);
});

export const submitBriefFeedbackAction = workspaceAction
	.schema(
		z.object({
			briefId: z.string().uuid(),
			reaction: z.enum(['helpful', 'not_helpful']),
			toneTraceId: z.string().uuid(),
			detailTraceId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');

		const rewardScore = parsedInput.reaction === 'helpful' ? 1.0 : 0.0;

		// Persist feedback to DB first — this is the user-visible state and must succeed
		await updateBriefFeedback(
			parsedInput.briefId,
			ctx.workspaceId,
			parsedInput.reaction === 'helpful',
		);

		// Fire bandit reward signals; log failures but don't fail the action
		const results = await Promise.allSettled([
			fetch(`${workerUrl}/feedback/reward`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': getInternalSecret(),
				},
				body: JSON.stringify({ traceId: parsedInput.toneTraceId, rewardScore }),
			}),
			fetch(`${workerUrl}/feedback/reward`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': getInternalSecret(),
				},
				body: JSON.stringify({ traceId: parsedInput.detailTraceId, rewardScore }),
			}),
		]);
		for (const result of results) {
			if (result.status === 'rejected') {
				console.error('[brief] Failed to send bandit reward:', result.reason);
			}
		}

		track(ctx.workspaceId, ctx.session.user.id, 'brief.feedback', {
			reaction: parsedInput.reaction,
		});

		return { success: true };
	});
