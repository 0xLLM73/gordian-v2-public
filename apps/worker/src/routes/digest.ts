import { hasUserAiAnalysisConsent } from '@repo/db';
import { Hono } from 'hono';
import { validateInternalSecret } from '../middleware/auth';
import { digestQueue } from '../queues/digest';

export const digest = new Hono();

const TERMINAL_DIGEST_JOB_STATES = new Set(['completed', 'failed']);

/**
 * POST /digest/generate — Enqueue a digest generation job.
 * Called by the web app's generateDigestAction server action.
 */
digest.post('/generate', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{
		userId: string;
		workspaceId: string;
		period: 'today' | 'yesterday' | '3d' | 'week';
	}>();

	if (!body.userId || !body.workspaceId || !body.period) {
		return c.json({ error: 'Missing required fields' }, 400);
	}

	if (!(await hasUserAiAnalysisConsent(body.userId, body.workspaceId))) {
		return c.json({ error: 'AI analysis consent is required.' }, 403);
	}

	// Deduplicate: same user + period = same jobId
	const jobId = `digest-${body.userId}-${body.period}`;
	const existingJob = await digestQueue.getJob(jobId);

	if (existingJob) {
		const state = await existingJob.getState();
		if (TERMINAL_DIGEST_JOB_STATES.has(state)) {
			await existingJob.remove();
		} else {
			return c.json({ queued: true, jobId, existing: true, state });
		}
	}

	await digestQueue.add(
		'generate-digest',
		{
			userId: body.userId,
			workspaceId: body.workspaceId,
			period: body.period,
		},
		{ jobId, priority: 1 },
	);

	return c.json({ queued: true, jobId });
});
