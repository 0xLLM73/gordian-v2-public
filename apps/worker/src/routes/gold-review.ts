import { getReviewQueueStats, listPendingExamples, promoteToGold, rejectExample } from '@repo/db';
import { Hono } from 'hono';
import { validateInternalSecret } from '../middleware/auth';

/**
 * Gold Owner Protocol — HTTP routes for Silver-to-Gold review workflow.
 * All routes require X-Internal-Secret header (admin/service-to-service).
 * SEC-004/005: All routes require workspaceId for tenant isolation.
 */
const goldReview = new Hono();

goldReview.use('*', async (c, next) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	await next();
});

goldReview.get('/pending', async (c) => {
	const workspaceId = c.req.query('workspaceId');
	if (!workspaceId) {
		return c.json({ error: 'workspaceId is required' }, 400);
	}

	const domain = c.req.query('domain');
	const limit = Number(c.req.query('limit') || '50');
	const offset = Number(c.req.query('offset') || '0');

	const examples = await listPendingExamples(workspaceId, domain, limit, offset);
	return c.json({ examples });
});

goldReview.post('/promote', async (c) => {
	const { goldenId, verifiedBy, verificationScore, workspaceId } = await c.req.json<{
		goldenId: string;
		verifiedBy: string;
		verificationScore?: number;
		workspaceId: string;
	}>();

	if (!goldenId || !verifiedBy || !workspaceId) {
		return c.json({ error: 'goldenId, verifiedBy, and workspaceId are required' }, 400);
	}

	const result = await promoteToGold(goldenId, verifiedBy, verificationScore, workspaceId);
	if (!result) {
		return c.json({ error: 'Example not found or not in pending status' }, 404);
	}

	return c.json({ status: 'promoted', id: result.id });
});

goldReview.post('/reject', async (c) => {
	const { goldenId, verifiedBy, workspaceId } = await c.req.json<{
		goldenId: string;
		verifiedBy: string;
		workspaceId: string;
	}>();

	if (!goldenId || !verifiedBy || !workspaceId) {
		return c.json({ error: 'goldenId, verifiedBy, and workspaceId are required' }, 400);
	}

	const result = await rejectExample(goldenId, verifiedBy, workspaceId);
	if (!result) {
		return c.json({ error: 'Example not found or not in pending status' }, 404);
	}

	return c.json({ status: 'rejected', id: result.id });
});

goldReview.get('/stats', async (c) => {
	const workspaceId = c.req.query('workspaceId');
	if (!workspaceId) {
		return c.json({ error: 'workspaceId is required' }, 400);
	}

	const stats = await getReviewQueueStats(workspaceId);
	return c.json(stats);
});

export { goldReview };
