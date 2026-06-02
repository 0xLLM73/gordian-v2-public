import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { workspaceMembers, workspaces } from '../schema/workspaces';

export async function isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
	const [member] = await db
		.select({ id: workspaceMembers.id })
		.from(workspaceMembers)
		.where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
		.limit(1);
	return !!member;
}

export async function isWorkspaceOwner(workspaceId: string, userId: string): Promise<boolean> {
	const [workspace] = await db
		.select({ ownerId: workspaces.ownerId })
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);
	return workspace?.ownerId === userId;
}
