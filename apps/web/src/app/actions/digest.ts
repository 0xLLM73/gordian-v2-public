'use server';

import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { getCalibration, getLatestDigest, listDigests } from '@repo/db';
import { z } from 'zod';

export const getLatestDigestAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return getLatestDigest(ctx.workspaceId, ctx.session.user.id, ctx.envelope);
	});

export const listDigestsAction = workspaceAction
	.schema(
		z.object({
			limit: z.number().int().positive().max(50).default(10),
		}),
	)
	.action(async ({ ctx, parsedInput }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return listDigests(ctx.workspaceId, ctx.session.user.id, ctx.envelope, {
			limit: parsedInput.limit,
		});
	});

export const generateDigestAction = workspaceAction
	.schema(
		z.object({
			period: z.enum(['today', 'yesterday', '3d', 'week']),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		const calibration = await getCalibration(ctx.session.user.id, ctx.workspaceId, ctx.envelope);
		if (calibration?.consentAiAnalysis !== true) {
			throw new Error('AI analysis consent is required');
		}

		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');
		const response = await fetch(`${workerUrl}/digest/generate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				period: parsedInput.period,
			}),
		});
		if (!response.ok) throw new Error('Failed to trigger digest generation');
		return { queued: true, period: parsedInput.period };
	});
