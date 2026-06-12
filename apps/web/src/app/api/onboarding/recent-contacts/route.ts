import { getHealthScoresByWorkspace, getUserTelegramAccountIds, listContacts } from '@repo/db';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getUserWorkspaceId, getWorkspaceEnvelope } from '@/lib/workspace';

export async function GET(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { allowed, retryAfterMs } = checkRateLimit(
		`${session.user.id}:onboarding-recent`,
		10,
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
		return NextResponse.json([]);
	}

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return NextResponse.json([]);
	}

	const url = new URL(req.url);
	const rawLimit = Number(url.searchParams.get('limit'));
	const limit = rawLimit > 0 && rawLimit <= 100 ? rawLimit : 30;
	const telegramAccountIds = await getUserTelegramAccountIds(session.user.id);

	if (telegramAccountIds.length === 0) {
		return NextResponse.json([]);
	}

	const contacts = await listContacts(workspaceId, envelope, {
		limit,
		sourceAccountIds: telegramAccountIds,
	});

	// Build a map of health scores keyed by contactId for O(1) lookup
	const healthScores = await getHealthScoresByWorkspace(workspaceId, { limit: 200 });
	const healthMap = new Map(healthScores.map((h) => [h.contactId, h]));

	// Return only safe fields — never expose raw ciphertext or PII beyond what's needed.
	// Include health label and recency so the client can filter for dormant/declining contacts.
	const result = contacts.map((c: Record<string, unknown>) => {
		const health = healthMap.get(c.id as string);
		return {
			id: c.id as string,
			firstName: (c.firstName as string) || '',
			lastName: (c.lastName as string) || '',
			healthLabel: health?.label ?? null,
			recency: health?.recency ?? null,
		};
	});

	return NextResponse.json(result);
}
