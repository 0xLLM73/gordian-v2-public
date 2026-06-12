'use server';

import { getOutcomeStats } from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

/**
 * Aggregate outcome win rate and counts by type for the workspace.
 * Used for the dashboard "Past Decisions" stats card.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getOutcomeStatsAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		return await getOutcomeStats(ctx.workspaceId);
	});
