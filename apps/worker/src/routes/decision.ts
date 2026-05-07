import { Hono } from 'hono';
import { z } from 'zod';
import { validateInternalSecret } from '../middleware/auth';
import { decisionQueue } from '../queues/decision-recording';

const app = new Hono();

const decisionRequestSchema = z.object({
	workspaceId: z.string().uuid(),
	userId: z.string().uuid(),
	decisionType: z.enum(['message', 'click', 'view', 'purchase', 'commitment', 'dismissal']),
	label: z.string().min(1).max(500),
	contactId: z.string().uuid().optional(),
	entityId: z.string().uuid().optional(),
	keyEnvelope: z.object({
		encryptedWrk: z.string().min(1),
		kmsContext: z.record(z.string(), z.string()),
		wrkVersion: z.number().int().positive(),
	}),
});

app.post('/decision/record', async (c) => {
	const secret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(secret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json();
	const parsed = decisionRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
	}

	// SEC-PROV-014: Job dedup ID prevents flooding
	const dedupSuffix = parsed.data.entityId ?? parsed.data.label.slice(0, 32);
	await decisionQueue.add('record', parsed.data, {
		jobId: `decision-${parsed.data.decisionType}-${dedupSuffix}`,
	});

	return c.json({ queued: true }, 202);
});

export default app;
