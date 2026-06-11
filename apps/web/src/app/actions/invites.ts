'use server';

import { actionClient, authAction, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import { getWorkspaceEnvelope } from '@/lib/workspace';
import { computeBlindIndex, getCurrentKeys, withKeys } from '@repo/crypto';
import {
	acceptInvite as dalAccept,
	createInvite as dalCreate,
	listInvites as dalList,
} from '@repo/db';
import {
	accounts,
	and,
	db,
	eq,
	sql,
	users,
	workspaceInvites,
	workspaceMembers,
	workspaces,
} from '@repo/db';
import { hashPassword } from 'better-auth/crypto';
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

export const inviteSignupAction = actionClient
	.schema(
		z.object({
			token: z.string().uuid(),
			name: z.string().min(1).max(200),
			email: z.string().email().max(320),
			password: z.string().min(8).max(256),
		}),
	)
	.action(async ({ parsedInput }) => {
		return db.transaction(async (tx) => {
			const [invite] = await tx
				.select({
					id: workspaceInvites.id,
					workspaceId: workspaceInvites.workspaceId,
					role: workspaceInvites.role,
					expiresAt: workspaceInvites.expiresAt,
					emailBlindIndex: workspaceInvites.emailBlindIndex,
				})
				.from(workspaceInvites)
				.where(
					and(
						eq(workspaceInvites.token, parsedInput.token),
						sql`${workspaceInvites.acceptedAt} IS NULL`,
					),
				)
				.limit(1);

			if (!invite) throw new Error('Invite not found or already used');
			if (new Date() > invite.expiresAt) throw new Error('Invite has expired');
			if (invite.emailBlindIndex) {
				const envelope = await getWorkspaceEnvelope(invite.workspaceId);
				if (!envelope) throw new Error('Workspace encryption key not found');
				const submittedEmailBlindIndex = await withKeys(envelope, async () => {
					const keys = getCurrentKeys();
					return computeBlindIndex(parsedInput.email, keys.bik);
				});
				if (submittedEmailBlindIndex !== invite.emailBlindIndex) {
					throw new Error('Invite email does not match');
				}
			}

			const [existingUser] = await tx
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, parsedInput.email))
				.limit(1);
			if (existingUser) throw new Error('Email already has an account');

			const passwordHash = await hashPassword(parsedInput.password);
			const [acceptedInvite] = await tx
				.update(workspaceInvites)
				.set({ acceptedAt: sql`now()` })
				.where(and(eq(workspaceInvites.id, invite.id), sql`${workspaceInvites.acceptedAt} IS NULL`))
				.returning({ id: workspaceInvites.id });
			if (!acceptedInvite) throw new Error('Invite not found or already used');

			const [user] = await tx
				.insert(users)
				.values({
					name: parsedInput.name,
					email: parsedInput.email,
					emailVerified: false,
				})
				.returning({ id: users.id });

			await tx.insert(accounts).values({
				accountId: user.id,
				providerId: 'credential',
				userId: user.id,
				password: passwordHash,
			});

			await tx.insert(workspaceMembers).values({
				workspaceId: invite.workspaceId,
				userId: user.id,
				role: invite.role,
			});

			return { workspaceId: invite.workspaceId, userId: user.id };
		});
	});
