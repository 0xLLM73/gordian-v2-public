import { db, eq, workspaces } from '@repo/db';

export async function isWorkspaceOwner(workspaceId: string, userId: string): Promise<boolean> {
	const [ws] = await db
		.select({ ownerId: workspaces.ownerId })
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	return ws?.ownerId === userId;
}

export async function assertWorkspaceOwner(workspaceId: string, userId: string): Promise<void> {
	const allowed = await isWorkspaceOwner(workspaceId, userId);
	if (!allowed) {
		throw new Error('Unauthorized');
	}
}
