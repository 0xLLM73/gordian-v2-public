import { Hono } from 'hono';
import { recordOutcome } from '../ai/bandit';
import { validateInternalSecret } from '../middleware/auth';

/**
 * Feedback route for closing the recursive learning loop.
 * Accepts reward signals and updates bandit ledger.
 *
 * Auth: X-Internal-Secret header (service-to-service).
 */

const feedback = new Hono();

feedback.post('/reward', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const { traceId, rewardScore } = await c.req.json<{
		traceId: string;
		rewardScore: number;
	}>();

	if (!traceId || typeof rewardScore !== 'number') {
		return c.json({ error: 'traceId and rewardScore are required' }, 400);
	}

	if (rewardScore < 0 || rewardScore > 1) {
		return c.json({ error: 'rewardScore must be between 0.0 and 1.0' }, 400);
	}

	await recordOutcome(traceId, rewardScore);

	return c.json({ status: 'ok' });
});

feedback.post('/helicone', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const { heliconeRequestId, rating, comment } = await c.req.json<{
		heliconeRequestId: string;
		rating: boolean;
		comment?: string;
	}>();

	if (!heliconeRequestId || typeof rating !== 'boolean') {
		return c.json({ error: 'heliconeRequestId and rating are required' }, 400);
	}

	const { sendHeliconeFeedback } = await import('../ai/helicone-feedback');
	await sendHeliconeFeedback(heliconeRequestId, rating, comment);

	return c.json({ status: 'ok' });
});

export { feedback };
