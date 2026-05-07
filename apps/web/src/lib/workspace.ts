import { auth } from '@/lib/auth';
import type { SealedEnvelope } from '@repo/crypto';
import { db, eq, workspaceMembers, workspaces } from '@repo/db';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Verify session and return user context.
 * Called at the top of every RSC data fetch (CVE-2025-29927 defense).
 */
export async function requireSession() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect('/login');
	}

	return session;
}

/**
 * Get the user's workspace ID. Looks up ownership first, then membership.
 * Returns null if the user has no workspace.
 */
export async function getUserWorkspaceId(userId: string): Promise<string | null> {
	// Check owned workspaces first
	const owned = await db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(eq(workspaces.ownerId, userId))
		.limit(1);

	if (owned.length > 0) return owned[0].id;

	// Check membership
	const member = await db
		.select({ workspaceId: workspaceMembers.workspaceId })
		.from(workspaceMembers)
		.where(eq(workspaceMembers.userId, userId))
		.limit(1);

	if (member.length > 0) return member[0].workspaceId;

	return null;
}

/**
 * Get the SealedEnvelope for a workspace.
 * Loads the encrypted WRK from the workspaces table.
 * Returns null if workspace not found.
 */
export async function getWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	if (result.length === 0) return null;

	const ws = result[0];
	// Defensive parse: kms_context may be stored as a JSON string-in-JSONB if
	// the workspace was created via create-workspace.mjs before the bug was fixed.
	// JSON.parse handles the double-encoded case; objects pass through unchanged.
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};
}
