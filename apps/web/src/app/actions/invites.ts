'use server';

import { authAction, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import {
	acceptInvite as dalAccept,
	createInvite as dalCreate,
	listInvites as dalList,
} from '@repo/db';
import { db, eq, workspaces } from '@repo/db';
import { z } from 'zod';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export const createInviteAction = workspaceAction
	.schema(
		z.object({
			email: z.string().email().optional(),
			role: z.enum(['admin', 'member']).default('member'),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		// Only workspace owner can create invites
		const [ws] = await db
			.select({ ownerId: workspaces.ownerId })
			.from(workspaces)
			.where(eq(workspaces.id, ctx.workspaceId))
			.limit(1);

		if (!ws || ws.ownerId !== ctx.session.user.id) {
			throw new Error('Unauthorized');
		}

		const invite = await dalCreate(
			ctx.workspaceId,
			ctx.session.user.id,
			{
				email: parsedInput.email,
				role: parsedInput.role,
			},
			ctx.envelope,
		);

		track(ctx.workspaceId, ctx.session.user.id, 'create_invite', {
			inviteId: invite?.id,
		});

		return {
			...invite,
			url: `${APP_URL}/invite/${invite?.token}`,
		};
	});

export const listInvitesAction = workspaceAction.schema(z.object({})).action(async ({ ctx }) => {
	// Only workspace owner can list invites
	const [ws] = await db
		.select({ ownerId: workspaces.ownerId })
		.from(workspaces)
		.where(eq(workspaces.id, ctx.workspaceId))
		.limit(1);

	if (!ws || ws.ownerId !== ctx.session.user.id) {
		throw new Error('Unauthorized');
	}

	return dalList(ctx.workspaceId, ctx.envelope);
});

export const acceptInviteAction = authAction
	.schema(z.object({ token: z.string().uuid() }))
	.action(async ({ parsedInput, ctx }) => {
		const invite = await dalAccept(parsedInput.token, ctx.session.user.id);
		track(invite.workspaceId, ctx.session.user.id, 'accept_invite', {
			inviteId: invite.id,
		});
		return { workspaceId: invite.workspaceId };
	});
