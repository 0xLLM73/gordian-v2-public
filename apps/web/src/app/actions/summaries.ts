'use server';

import { workspaceAction } from '@/lib/safe-action';
import { getLatestSummary } from '@repo/db';
import { z } from 'zod';

export const getSummaryAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');
		return getLatestSummary(ctx.workspaceId, parsedInput.contactId, ctx.envelope);
	});
