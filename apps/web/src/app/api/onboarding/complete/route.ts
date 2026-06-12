import { upsertPreferences } from '@repo/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { track } from '@/lib/track';
import { getUserWorkspaceId } from '@/lib/workspace';

export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { allowed, retryAfterMs } = checkRateLimit(
		`${session.user.id}:onboarding-complete`,
		3,
		60_000,
	);
	if (!allowed) {
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
		});
	}

	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) {
		return NextResponse.json({ error: 'No workspace found' }, { status: 400 });
	}

	const body = (await req.json().catch(() => ({}))) as { timezone?: string };

	// SEC-TZ-001: Validate timezone is a real IANA identifier before storing.
	// Prevents malformed values from crashing the morning-brief scheduler.
	let timezone = 'America/New_York';
	if (typeof body.timezone === 'string' && body.timezone.length <= 64) {
		try {
			Intl.DateTimeFormat(undefined, { timeZone: body.timezone });
			timezone = body.timezone;
		} catch {
			// Invalid IANA timezone — fall back to default
		}
	}

	await upsertPreferences(workspaceId, session.user.id, {
		timezone,
		briefEnabled: true,
	});

	// Bootstrap first morning brief schedule (non-fatal — onboarding succeeds even if worker is down)
	try {
		const workerUrl = process.env.WORKER_URL;
		const secret = process.env.WORKER_INTERNAL_SECRET || process.env.INTERNAL_AUTH_SECRET;
		if (workerUrl && secret) {
			await fetch(`${workerUrl}/brief/schedule`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': secret,
				},
				body: JSON.stringify({ userId: session.user.id, workspaceId }),
			});
		}
	} catch {
		// Non-fatal: worker may be unreachable during onboarding
	}

	track(workspaceId, session.user.id, 'onboarding.completed');

	return NextResponse.json({ success: true });
}
