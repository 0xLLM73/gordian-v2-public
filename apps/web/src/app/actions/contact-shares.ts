'use server';

import { workspaceAction } from '@/lib/safe-action';
import {
	getUserTelegramAccountIds as dalGetAccounts,
	getContactShares as dalGetShares,
	shareContact as dalShare,
	unshareContact as dalUnshare,
} from '@repo/db';
import { z } from 'zod';

export const shareContactAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			targetUserId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalShare(
			ctx.workspaceId,
			parsedInput.contactId,
			parsedInput.targetUserId,
			ctx.session.user.id,
		);
	});

export const unshareContactAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
			targetUserId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		await dalUnshare(ctx.workspaceId, parsedInput.contactId, parsedInput.targetUserId);
		return { success: true };
	});

export const getContactSharesAction = workspaceAction
	.schema(
		z.object({
			contactId: z.string().uuid(),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		return dalGetShares(ctx.workspaceId, parsedInput.contactId);
	});

export const getMyTelegramAccountsAction = workspaceAction
	.schema(z.object({}))
	.action(async ({ ctx }) => {
		return dalGetAccounts(ctx.session.user.id);
	});
