'use server';

import {
	getPreferences as dalGetPreferences,
	upsertPreferences as dalUpsertPreferences,
} from '@repo/db';
import { z } from 'zod';
import { workspaceAction } from '@/lib/safe-action';

export const getPreferencesAction = workspaceAction.schema(z.object({})).action(async ({ ctx }) => {
	return dalGetPreferences(ctx.workspaceId, ctx.session.user.id);
});

export const updatePreferencesAction = workspaceAction
	.schema(
		z.object({
			timezone: z.string().min(1).max(50).optional(),
			briefEnabled: z.boolean().optional(),
			briefTime: z.number().int().min(0).max(23).optional(),
			briefDays: z
				.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']))
				.min(0)
				.max(7)
				.optional(),
			digestFocus: z
				.enum(['balanced', 'commitments', 'relationships', 'deals', 'network'])
				.optional(),
			introKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
			connectionKeywords: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
			ghostingAlertStatuses: z
				.array(z.enum(['cooling', 'dormant']))
				.min(0)
				.max(2)
				.optional(),
			ghostingStaleDays: z.number().int().min(7).max(180).optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalUpsertPreferences(ctx.workspaceId, ctx.session.user.id, parsedInput);
	});
