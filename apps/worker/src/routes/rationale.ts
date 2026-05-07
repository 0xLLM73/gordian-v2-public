import { Hono } from 'hono';
import { z } from 'zod';
import { validateInternalSecret } from '../middleware/auth';
import { rationaleQueue } from '../queues/rationale-extraction';

const app = new Hono();

// SEC-PROV-005: Zod schema for input validation
const rationaleRequestSchema = z.object({
	action: z.string().min(1).max(100),
	label: z.string().min(1).max(200),
	contactId: z.string().uuid().optional(),
	entityId: z.string().uuid(),
	entityType: z.enum(['deal', 'introduction', 'recommendation', 'commitment', 'contact']),
	workspaceId: z.string().uuid(),
	keyEnvelope: z.object({
		encryptedWrk: z.string().min(1),
		kmsContext: z.record(z.string(), z.string()),
		wrkVersion: z.number().int().positive(),
	}),
});

app.post('/rationale/extract', async (c) => {
	// SEC-PROV-010: Guard against empty string and undefined secret
	const secret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(secret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json();
	const parsed = rationaleRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
	}

	// SEC-PROV-014: Job dedup ID prevents flooding
	await rationaleQueue.add('extract', parsed.data, {
		jobId: `rationale-${parsed.data.entityType}-${parsed.data.entityId}`,
	});

	return c.json({ queued: true });
});

export default app;
