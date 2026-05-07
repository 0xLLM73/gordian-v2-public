'use server';

import { workspaceAction } from '@/lib/safe-action';
import { getDashboardStats } from '@repo/db';
import { z } from 'zod';

export const getOnboardingStatsAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		const stats = await getDashboardStats(ctx.workspaceId);
		return {
			contacts: stats.contactCount,
			commitments: stats.activeCommitmentCount,
			messages: 0, // Message count not in dashboard stats
		};
	});
