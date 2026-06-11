import { withKeys } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { workspaceInvites } from '../schema/workspaces';
import { workspaces } from '../schema/workspaces';
import { workspaceMembers } from '../schema/workspaces';

export interface CreateInviteInput {
	email?: string;
	role?: 'admin' | 'member';
}

export interface InviteWithWorkspace {
	id: string;
	workspaceId: string;
	email: string | null;
	role: string;
	token: string;
	expiresAt: Date;
	acceptedAt: Date | null;
	createdBy: string;
	createdAt: Date;
	workspaceName: string;
}

export async function createInvite(
	workspaceId: string,
	createdBy: string,
	opts: CreateInviteInput | undefined,
	envelope: SealedEnvelope,
) {
	return withKeys(envelope, async () => {
		const token = crypto.randomUUID();
		const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

		const result = await db
			.insert(workspaceInvites)
			.values({
				workspaceId,
				email: opts?.email ?? null,
				emailBlindIndex: opts?.email ?? null,
				role: opts?.role ?? 'member',
				token,
				expiresAt,
				createdBy,
			})
			.returning();

		return result[0] ?? null;
	});
}

export async function getInviteByToken(token: string): Promise<InviteWithWorkspace | null> {
	// SEC-ENC-508: Exclude encrypted email — can't decrypt without withKeys context.
	// Email is optional; invite page signup form will have an editable email field.
	const result = await db
		.select({
			id: workspaceInvites.id,
			workspaceId: workspaceInvites.workspaceId,
			role: workspaceInvites.role,
			token: workspaceInvites.token,
			expiresAt: workspaceInvites.expiresAt,
			acceptedAt: workspaceInvites.acceptedAt,
			createdBy: workspaceInvites.createdBy,
			createdAt: workspaceInvites.createdAt,
			workspaceName: workspaces.name,
		})
		.from(workspaceInvites)
		.innerJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
		.where(eq(workspaceInvites.token, token))
		.limit(1);

	if (!result[0]) return null;
	return { ...result[0], email: null };
}

export async function acceptInvite(token: string, userId: string) {
	return db.transaction(async (tx) => {
		// SEC-ENC-509: Exclude encrypted columns (email, emailBlindIndex) — no withKeys
		// context available during pre-auth invite acceptance.
		const [invite] = await tx
			.select({
				id: workspaceInvites.id,
				workspaceId: workspaceInvites.workspaceId,
				role: workspaceInvites.role,
				token: workspaceInvites.token,
				expiresAt: workspaceInvites.expiresAt,
				acceptedAt: workspaceInvites.acceptedAt,
				createdBy: workspaceInvites.createdBy,
				createdAt: workspaceInvites.createdAt,
			})
			.from(workspaceInvites)
			.where(and(eq(workspaceInvites.token, token), isNull(workspaceInvites.acceptedAt)))
			.limit(1);

		if (!invite) throw new Error('Invite not found or already used');
		if (new Date() > invite.expiresAt) throw new Error('Invite has expired');

		const [acceptedInvite] = await tx
			.update(workspaceInvites)
			.set({ acceptedAt: sql`now()` })
			.where(and(eq(workspaceInvites.id, invite.id), isNull(workspaceInvites.acceptedAt)))
			.returning({ id: workspaceInvites.id });
		if (!acceptedInvite) throw new Error('Invite not found or already used');

		await tx.insert(workspaceMembers).values({
			workspaceId: invite.workspaceId,
			userId,
			role: invite.role,
		});

		return invite;
	});
}

export async function createWorkspace(
	userId: string,
	name: string,
	encryptedWrk: string,
	kmsContext: Record<string, string>,
	opts?: { id?: string },
) {
	return db.transaction(async (tx) => {
		const [workspace] = await tx
			.insert(workspaces)
			.values({
				...(opts?.id ? { id: opts.id } : {}),
				name,
				ownerId: userId,
				encryptedWrk,
				kmsContext,
			})
			.returning();

		await tx.insert(workspaceMembers).values({
			workspaceId: workspace.id,
			userId,
			role: 'admin',
		});

		return workspace;
	});
}

export async function listInvites(workspaceId: string, envelope: SealedEnvelope) {
	return withKeys(envelope, async () => {
		return db
			.select()
			.from(workspaceInvites)
			.where(eq(workspaceInvites.workspaceId, workspaceId))
			.orderBy(sql`${workspaceInvites.createdAt} desc`);
	});
}
