import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getInternalSecret } from '@/lib/safe-action';
import { getUserWorkspaceId, getWorkspaceEnvelope } from '@/lib/workspace';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { allowed, retryAfterMs } = checkRateLimit(`${session.user.id}:chat-stream`, 5, 60_000);
	if (!allowed) {
		return new Response('Too Many Requests', {
			status: 429,
			headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
		});
	}

	const workspaceId = await getUserWorkspaceId(session.user.id);
	if (!workspaceId) {
		return NextResponse.json({ error: 'No workspace found' }, { status: 403 });
	}

	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return NextResponse.json({ error: 'Workspace encryption key not found' }, { status: 500 });
	}

	let body: { messages: unknown[]; context?: Record<string, unknown> };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!body.messages || !Array.isArray(body.messages)) {
		return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
	}

	const workerUrl = process.env.WORKER_URL ?? 'http://localhost:3001';

	let workerResponse: Response;
	try {
		workerResponse = await fetch(`${workerUrl}/chat/stream`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({
				workspaceId,
				messages: body.messages,
				envelope: {
					encryptedWrk: envelope.encryptedWrk.toString('base64'),
					kmsContext: envelope.kmsContext,
					wrkVersion: envelope.wrkVersion,
				},
				context: body.context,
			}),
		});
	} catch {
		return NextResponse.json({ error: 'Chat service unavailable' }, { status: 502 });
	}

	if (!workerResponse.ok) {
		return NextResponse.json(
			{ error: 'Chat service unavailable' },
			{ status: workerResponse.status },
		);
	}

	if (!workerResponse.body) {
		return NextResponse.json({ error: 'No response stream' }, { status: 502 });
	}

	return new Response(workerResponse.body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		},
	});
}
