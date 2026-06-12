'use server';

import { getDecisionsByWorkspace as dalGetDecisions } from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

export const getDecisionsAction = workspaceAction
	.schema(
		z.object({
			limit: z.number().int().positive().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return dalGetDecisions(ctx.workspaceId, ctx.envelope, {
			limit: parsedInput.limit,
		});
	});
