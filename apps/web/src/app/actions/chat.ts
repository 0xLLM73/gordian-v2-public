'use server';

import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import { z } from 'zod';

const chatMessageSchema = z.object({
	role: z.enum(['user', 'assistant']),
	content: z.string().min(1).max(4000),
});

export const sendChatMessageAction = workspaceAction
	.schema(
		z.object({
			messages: z.array(chatMessageSchema).min(1).max(50),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		if (!ctx.envelope) throw new Error('Workspace encryption key not found');

		const workerUrl = process.env.WORKER_URL;
		if (!workerUrl) throw new Error('WORKER_URL is not configured');
		const response = await fetch(`${workerUrl}/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({
				userId: ctx.session.user.id,
				workspaceId: ctx.workspaceId,
				messages: parsedInput.messages,
				envelope: {
					encryptedWrk: Buffer.from(ctx.envelope.encryptedWrk).toString('base64'),
					kmsContext: ctx.envelope.kmsContext,
					wrkVersion: ctx.envelope.wrkVersion,
				},
			}),
		});

		if (!response.ok) {
			let errorMessage = 'Chat service unavailable';
			try {
				const body = (await response.json()) as { error?: unknown };
				if (typeof body.error === 'string' && body.error.includes('AI analysis consent')) {
					errorMessage = body.error;
				}
			} catch {
				// Keep the generic service error when the worker does not return JSON.
			}
			throw new Error(errorMessage);
		}

		track(ctx.workspaceId, ctx.session.user.id, 'use_chat');
		return response.json() as Promise<{ response: string; toolsUsed: string[] }>;
	});
