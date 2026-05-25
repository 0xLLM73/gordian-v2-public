import { Hono } from 'hono';
import { z } from 'zod';
import { validateInternalSecret } from '../middleware/auth';
import { cleanupRuntimeStateForDeletion } from '../runtime-cleanup';

const cleanupSchema = z.object({
	userId: z.string().uuid(),
	workspaceId: z.string().uuid(),
});

export const runtimeCleanup = new Hono();

runtimeCleanup.post('/cleanup-deletion', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const parsed = cleanupSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: 'userId and workspaceId are required' }, 400);
	}

	const result = await cleanupRuntimeStateForDeletion(parsed.data);
	return c.json(result);
});
