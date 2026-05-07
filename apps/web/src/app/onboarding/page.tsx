import { getUserWorkspaceId, requireSession } from '@/lib/workspace';
import { contacts, db, eq, sql } from '@repo/db';
import { redirect } from 'next/navigation';

export default async function OnboardingRedirectPage() {
	const session = await requireSession();
	const workspaceId = await getUserWorkspaceId(session.user.id);

	if (!workspaceId) {
		// No workspace yet — start from Connect
		redirect('/onboarding/connect');
	}

	// Check if contacts exist to determine sync progress
	const [result] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(contacts)
		.where(eq(contacts.workspaceId, workspaceId));

	const contactCount = result?.count ?? 0;

	if (contactCount === 0) {
		// Workspace exists but no contacts — sync hasn't started or just started
		redirect('/onboarding/sync');
	}

	// Has contacts — go to calibrate (auto-skips if not needed)
	redirect('/onboarding/calibrate');
}
