import { isFeatureEnabled } from '@repo/db';
import { notFound } from 'next/navigation';
import { getUserWorkspaceId, requireSession } from '@/lib/workspace';

/**
 * Call at the top of a page's server component to gate it behind a feature flag.
 * Returns 404 if the flag is not enabled for the user's workspace.
 */
export async function requireFeature(key: string): Promise<void> {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) notFound();

	const enabled = await isFeatureEnabled(key, workspaceId);
	if (!enabled) notFound();
}
