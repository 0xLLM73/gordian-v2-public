import { hasUserAiAnalysisConsent, isWorkspaceMember } from '@repo/db';
import { redactSensitive } from '@repo/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { type ChatMessage, chat } from '../ai/chat';
import { type ChatContext, chatStream } from '../ai/chat-stream';
import { validateInternalSecret } from '../middleware/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ChatRequestBody {
	userId: string;
	workspaceId: string;
	messages: ChatMessage[];
	envelope: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
	context?: ChatContext;
}

const chatRoutes = new Hono();

chatRoutes.post('/', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<ChatRequestBody>();

	if (!body.userId || !body.workspaceId || !body.messages || !body.envelope) {
		return c.json({ error: 'userId, workspaceId, messages, and envelope are required' }, 400);
	}
	if (!UUID_RE.test(body.userId) || !UUID_RE.test(body.workspaceId)) {
		return c.json({ error: 'Invalid userId or workspaceId format' }, 400);
	}
	if (!(await isWorkspaceMember(body.workspaceId, body.userId))) {
		return c.json({ error: 'User is not a member of this workspace.' }, 403);
	}
	if (!(await hasUserAiAnalysisConsent(body.userId, body.workspaceId))) {
		return c.json({ error: 'AI analysis consent is required.' }, 403);
	}

	// Reconstruct SealedEnvelope from base64
	const envelope = {
		encryptedWrk: Buffer.from(body.envelope.encryptedWrk, 'base64'),
		kmsContext: body.envelope.kmsContext,
		wrkVersion: body.envelope.wrkVersion,
	};

	try {
		const result = await chat(body.workspaceId, envelope, body.messages);
		return c.json(result);
	} catch (err) {
		console.error('[chat] Error:', redactSensitive(err));
		return c.json({ error: 'Chat service unavailable' }, 500);
	}
});

chatRoutes.post('/stream', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<ChatRequestBody>();

	if (!body.userId || !body.workspaceId || !body.messages || !body.envelope) {
		return c.json({ error: 'userId, workspaceId, messages, and envelope are required' }, 400);
	}
	if (!UUID_RE.test(body.userId) || !UUID_RE.test(body.workspaceId)) {
		return c.json({ error: 'Invalid userId or workspaceId format' }, 400);
	}
	if (!(await isWorkspaceMember(body.workspaceId, body.userId))) {
		return c.json({ error: 'User is not a member of this workspace.' }, 403);
	}
	if (!(await hasUserAiAnalysisConsent(body.userId, body.workspaceId))) {
		return c.json({ error: 'AI analysis consent is required.' }, 403);
	}

	const envelope = {
		encryptedWrk: Buffer.from(body.envelope.encryptedWrk, 'base64'),
		kmsContext: body.envelope.kmsContext,
		wrkVersion: body.envelope.wrkVersion,
	};

	return streamSSE(c, async (stream) => {
		let eventId = 0;

		await chatStream(
			body.workspaceId,
			envelope,
			body.messages,
			'',
			{
				async onToolStart(toolName: string) {
					await stream.writeSSE({
						event: 'tool_start',
						data: JSON.stringify({ tool: toolName }),
						id: String(++eventId),
					});
				},
				async onToolEnd(toolName: string) {
					await stream.writeSSE({
						event: 'tool_end',
						data: JSON.stringify({ tool: toolName }),
						id: String(++eventId),
					});
				},
				async onTextDelta(text: string) {
					await stream.writeSSE({
						event: 'text_delta',
						data: JSON.stringify({ text }),
						id: String(++eventId),
					});
				},
				async onDone(toolsUsed: string[]) {
					await stream.writeSSE({
						event: 'done',
						data: JSON.stringify({ toolsUsed }),
						id: String(++eventId),
					});
				},
				async onError(message: string) {
					await stream.writeSSE({
						event: 'error',
						data: JSON.stringify({ message: redactSensitive(message) }),
						id: String(++eventId),
					});
				},
				async onProposal(proposal: unknown) {
					await stream.writeSSE({
						event: 'proposal',
						data: JSON.stringify(proposal),
						id: String(++eventId),
					});
				},
			},
			body.context,
		);
	});
});

export { chatRoutes };
