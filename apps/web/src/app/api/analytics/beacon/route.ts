import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { hasAnalyticsConsent, trackBehavior } from '@repo/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * POST /api/analytics/beacon — receives sendBeacon payloads for abandon tracking.
 * Used by onboarding pages to track step abandonment on tab close / navigation away.
 * sendBeacon sends Content-Type: text/plain, so we parse JSON from the body text.
 */
export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return new NextResponse(null, { status: 204 });
	}

	const { allowed } = checkRateLimit(`${session.user.id}:analytics-beacon`, 30, 60_000);
	if (!allowed) {
		return new NextResponse(null, { status: 204 });
	}

	try {
		const text = await req.text();
		const body = JSON.parse(text) as {
			workspaceId?: string;
			event?: string;
			properties?: Record<string, unknown>;
		};

		if (!body.workspaceId || !body.event) {
			return new NextResponse(null, { status: 204 });
		}

		const consented = await hasAnalyticsConsent(session.user.id, body.workspaceId);
		if (!consented) {
			return new NextResponse(null, { status: 204 });
		}

		void trackBehavior(body.workspaceId, session.user.id, body.event, body.properties).catch(
			() => {},
		);
	} catch {
		// sendBeacon payloads are best-effort — never fail
	}

	return new NextResponse(null, { status: 204 });
}
