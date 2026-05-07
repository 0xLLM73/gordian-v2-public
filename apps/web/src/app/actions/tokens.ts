'use server';

import { workspaceAction } from '@/lib/safe-action';
import {
	addToWatchlist as dalAddToWatchlist,
	getTopMentionedTokens as dalGetTopMentions,
	getWatchlist as dalGetWatchlist,
	removeFromWatchlist as dalRemoveFromWatchlist,
} from '@repo/db';
import { z } from 'zod';

export const getWatchlistAction = workspaceAction.schema(z.object({})).action(async ({ ctx }) => {
	return dalGetWatchlist(ctx.workspaceId);
});

export const getTopMentionsAction = workspaceAction
	.schema(z.object({ limit: z.number().int().positive().optional() }))
	.action(async ({ parsedInput, ctx }) => {
		return dalGetTopMentions(ctx.workspaceId, parsedInput.limit ?? 10);
	});

export const addToWatchlistAction = workspaceAction
	.schema(
		z.object({
			symbol: z.string().min(1).max(10),
			name: z.string().optional(),
			coingeckoId: z.string().optional(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalAddToWatchlist(ctx.workspaceId, parsedInput);
	});

export const removeFromWatchlistAction = workspaceAction
	.schema(z.object({ symbol: z.string().min(1) }))
	.action(async ({ parsedInput, ctx }) => {
		return dalRemoveFromWatchlist(ctx.workspaceId, parsedInput.symbol);
	});
