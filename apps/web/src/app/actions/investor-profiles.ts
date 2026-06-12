'use server';

import { getInvestorProfile, getTopInvestors } from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

/**
 * Get the investor profile for a specific contact.
 * Workspace scoping prevents cross-tenant reads.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getInvestorProfileAction = workspaceAction
	.schema(z.object({ contactId: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		return await getInvestorProfile(ctx.workspaceId, parsedInput.contactId);
	});

/**
 * Return top investors in the workspace ranked by win rate then deal count.
 * CRITICAL: Uses workspaceAction — workspaceId never from client.
 */
export const getTopInvestorsAction = workspaceAction
	.schema(z.object({ limit: z.number().int().min(1).max(50).default(5) }))
	.action(async ({ parsedInput, ctx }) => {
		return await getTopInvestors(ctx.workspaceId, parsedInput.limit);
	});
