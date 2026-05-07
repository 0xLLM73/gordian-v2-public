import { getLatestBrief } from '@repo/db';
import { Hono } from 'hono';
import { validateInternalSecret } from '../middleware/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const briefRoutes = new Hono();

/**
 * POST /brief/latest — Return the most recent morning brief for a user.
 * The envelope is passed in the request body so content can be decrypted server-side.
 * Auth: X-Internal-Secret header (service-to-service).
 */
briefRoutes.post('/latest', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{
		userId: string;
		workspaceId: string;
		envelope: {
			encryptedWrk: string;
			kmsContext: Record<string, string>;
			wrkVersion: number;
		};
	}>();

	if (!body.userId || !body.workspaceId || !body.envelope) {
		return c.json({ error: 'userId, workspaceId, and envelope are required' }, 400);
	}

	const envelope = {
		encryptedWrk: Buffer.from(body.envelope.encryptedWrk, 'base64'),
		kmsContext: body.envelope.kmsContext,
		wrkVersion: body.envelope.wrkVersion,
	};

	try {
		const brief = await getLatestBrief(body.workspaceId, body.userId, envelope);
		return c.json(brief);
	} catch (err) {
		console.error('[brief] Error fetching latest brief:', err instanceof Error ? err.message : err);
		return c.json({ error: 'Failed to fetch brief' }, 500);
	}
});

/**
 * POST /brief/schedule — Bootstrap first morning brief (called from onboarding).
 * Auth: X-Internal-Secret header (service-to-service).
 */
briefRoutes.post('/schedule', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{ userId: string; workspaceId: string }>();
	if (
		!body.userId ||
		!UUID_RE.test(body.userId) ||
		!body.workspaceId ||
		!UUID_RE.test(body.workspaceId)
	) {
		return c.json({ error: 'Valid userId and workspaceId UUIDs are required' }, 400);
	}

	const { scheduleMorningBrief } = await import('../ai/morning-brief');
	await scheduleMorningBrief(body.userId, body.workspaceId, '');
	return c.json({ scheduled: true });
});

/**
 * POST /brief/reschedule — Cancel + reschedule morning brief (called from settings).
 * Auth: X-Internal-Secret header (service-to-service).
 */
briefRoutes.post('/reschedule', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{ userId: string; workspaceId: string }>();
	if (
		!body.userId ||
		!UUID_RE.test(body.userId) ||
		!body.workspaceId ||
		!UUID_RE.test(body.workspaceId)
	) {
		return c.json({ error: 'Valid userId and workspaceId UUIDs are required' }, 400);
	}

	const { briefQueue, scheduleMorningBrief } = await import('../ai/morning-brief');
	const oldJob = await briefQueue.getJob(`brief-${body.userId}`);
	if (oldJob) {
		await oldJob.remove().catch(() => {});
	}

	await scheduleMorningBrief(body.userId, body.workspaceId, '');
	return c.json({ rescheduled: true });
});
