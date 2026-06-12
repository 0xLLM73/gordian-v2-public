import { createCalendarConnection } from '@repo/db';
import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { verifyOAuthState } from '@/lib/oauth-state';
import { checkRateLimit } from '@/lib/rate-limit';
import { getUserWorkspaceId, getWorkspaceEnvelope } from '@/lib/workspace';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/calendar/callback`;

/**
 * GET /api/calendar/callback — Handle Google OAuth callback
 */
export async function GET(request: NextRequest) {
	// Use configured public URL for all browser redirects — request.url is the
	// Docker-internal address and would send users to 0.0.0.0:3000 in production.
	const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.redirect(new URL('/login', baseUrl));
	}

	const { allowed } = checkRateLimit(`${session.user.id}:calendar-callback`, 10, 60_000);
	if (!allowed) {
		return NextResponse.redirect(new URL('/settings?error=rate-limited', baseUrl));
	}

	const code = request.nextUrl.searchParams.get('code');
	const stateParam = request.nextUrl.searchParams.get('state');

	if (!code || !stateParam) {
		return NextResponse.redirect(new URL('/settings?error=failed', baseUrl));
	}

	// SEC: Verify HMAC-signed state to extract workspaceId
	const workspaceId = verifyOAuthState(stateParam);
	if (!workspaceId) {
		return NextResponse.redirect(new URL('/settings?error=failed', baseUrl));
	}

	// SEC-104: Verify the authenticated user actually belongs to this workspace
	const userWorkspaceId = await getUserWorkspaceId(session.user.id);
	if (userWorkspaceId !== workspaceId) {
		return NextResponse.redirect(new URL('/settings?error=failed', request.url));
	}

	if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
		return NextResponse.redirect(new URL('/settings?error=failed', baseUrl));
	}

	try {
		// Exchange code for tokens
		const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: GOOGLE_CLIENT_ID,
				client_secret: GOOGLE_CLIENT_SECRET,
				redirect_uri: GOOGLE_REDIRECT_URI,
				grant_type: 'authorization_code',
			}),
		});

		if (!tokenResponse.ok) {
			console.error('[calendar] Token exchange failed');
			return NextResponse.redirect(new URL('/settings?error=failed', baseUrl));
		}

		const tokens = (await tokenResponse.json()) as {
			access_token: string;
			refresh_token?: string;
			expires_in?: number;
		};

		// Get user email from Google
		const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
			headers: { Authorization: `Bearer ${tokens.access_token}` },
		});
		const profile = profileResponse.ok
			? ((await profileResponse.json()) as { email?: string })
			: { email: undefined };

		// Store encrypted tokens in database
		const envelope = await getWorkspaceEnvelope(workspaceId);
		if (!envelope) {
			return NextResponse.redirect(new URL('/settings?error=failed', baseUrl));
		}

		await createCalendarConnection(
			workspaceId,
			{
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token ?? '',
				expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
				email: profile.email,
			},
			envelope,
		);

		return NextResponse.redirect(new URL('/settings?calendar=connected', baseUrl));
	} catch (err) {
		console.error('[calendar] OAuth callback error:', err instanceof Error ? err.message : err);
		return NextResponse.redirect(new URL('/settings?error=failed', baseUrl));
	}
}
