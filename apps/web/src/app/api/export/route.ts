import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getUserWorkspaceId, getWorkspaceEnvelope } from '@/lib/workspace';
import { getActiveCommitments, listContacts, listDeals } from '@repo/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * GET /api/export — Export contacts, commitments, and deals as JSON.
 * Requires authenticated session with workspace.
 */
export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { allowed, retryAfterMs } = checkRateLimit(`${session.user.id}:export`, 2, 60_000);
	if (!allowed) {
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
		});
	}

	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
	}

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return NextResponse.json({ error: 'Service unavailable' }, { status: 500 });
	}

	const [contacts, commitments, deals] = await Promise.all([
		listContacts(workspaceId, envelope, { limit: 10000 }),
		getActiveCommitments(workspaceId, envelope, { limit: 10000 }),
		listDeals(workspaceId, envelope, { limit: 10000 }),
	]);

	const exportData = {
		exportedAt: new Date().toISOString(),
		contacts,
		commitments,
		deals,
	};

	return new NextResponse(JSON.stringify(exportData, null, 2), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="gordian-export-${new Date().toISOString().slice(0, 10)}.json"`,
		},
	});
}
