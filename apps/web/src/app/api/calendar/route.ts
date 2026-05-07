import { auth } from '@/lib/auth';
import { buildOAuthState } from '@/lib/oauth-state';
import { checkRateLimit } from '@/lib/rate-limit';
import { getUserWorkspaceId } from '@/lib/workspace';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/calendar/callback`;

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

/**
 * GET /api/calendar — Redirect to Google OAuth consent screen
 */
export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { allowed, retryAfterMs } = checkRateLimit(`${session.user.id}:calendar`, 10, 60_000);
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

	if (!GOOGLE_CLIENT_ID) {
		return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
	}

	const params = new URLSearchParams({
		client_id: GOOGLE_CLIENT_ID,
		redirect_uri: GOOGLE_REDIRECT_URI,
		response_type: 'code',
		scope: SCOPES.join(' '),
		access_type: 'offline',
		prompt: 'consent',
		state: buildOAuthState(workspaceId),
	});

	return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
