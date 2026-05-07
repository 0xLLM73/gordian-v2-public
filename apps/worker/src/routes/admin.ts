import type { SealedEnvelope } from '@repo/crypto';
import { deriveKeys, encrypt, unwrapWrk } from '@repo/crypto';
import { contacts, db, eq, getMessagesByContact, sql, workspaces } from '@repo/db';
import { Hono } from 'hono';
import { validateInternalSecret } from '../middleware/auth';
import { scheduleAIPipeline } from '../queues/ai-flow';
import { embeddingBackfillQueue } from '../queues/backfill';
import { healthScoringQueue } from '../queues/health-scoring';
import { syncQueue } from '../queues/sync';

/**
 * Admin routes for operational tasks.
 * All routes require X-Internal-Secret header (SEC-029).
 *
 * POST /admin/backfill-embeddings
 *   Enqueues an embedding backfill job for a workspace.
 *
 * POST /admin/reprocess-messages
 *   Reprocesses existing messages through the AI pipeline for a workspace.
 *
 * POST /admin/trigger-health
 *   Triggers health scoring for a specific workspace (or all workspaces).
 *
 * POST /admin/trigger-sync
 *   Triggers a Telegram sync for a specific user/workspace pair.
 *
 * POST /admin/dedup-memories
 *   Deduplicates memories by (workspace_id, contact_id, category, content_sanitized).
 */
const admin = new Hono();

admin.post('/backfill-embeddings', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{
		workspaceId?: string;
		userId?: string;
		batchSize?: number;
	}>();

	const { workspaceId, userId, batchSize = 50 } = body;

	if (!workspaceId || !userId) {
		return c.json({ error: 'workspaceId and userId are required' }, 400);
	}

	const job = await embeddingBackfillQueue.add('embedding-backfill', {
		workspaceId,
		userId,
		batchSize,
	});

	console.log(
		`[admin] Enqueued embedding-backfill job=${job.id} for workspace=${workspaceId.slice(0, 8)}`,
	);

	return c.json({ status: 'queued', jobId: job.id, workspaceId, batchSize });
});

/**
 * Fetch the workspace encryption envelope from the database (SEC-028).
 */
async function getWorkspaceEnvelope(workspaceId: string): Promise<SealedEnvelope | null> {
	const result = await db
		.select({
			encryptedWrk: workspaces.encryptedWrk,
			kmsContext: workspaces.kmsContext,
			wrkVersion: workspaces.wrkVersion,
		})
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.limit(1);

	if (result.length === 0) return null;

	const ws = result[0];
	const rawCtx = ws.kmsContext;
	const kmsContext: Record<string, string> =
		typeof rawCtx === 'string' ? JSON.parse(rawCtx) : (rawCtx as Record<string, string>);
	return {
		encryptedWrk: Buffer.from(ws.encryptedWrk, 'base64'),
		kmsContext,
		wrkVersion: ws.wrkVersion,
	};
}

admin.post('/reprocess-messages', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{
		workspaceId: string;
		userId: string;
		batchSize?: number;
	}>();

	const { workspaceId, userId } = body;
	if (!workspaceId || !userId) {
		return c.json({ error: 'workspaceId and userId are required' }, 400);
	}

	// Resolve workspace envelope from DB (SEC-028)
	const envelope = await getWorkspaceEnvelope(workspaceId);
	if (!envelope) {
		return c.json({ error: 'Workspace envelope not found' }, 404);
	}

	// Derive keys from envelope (same pattern as sync.ts lines 586-617)
	const wrk = await unwrapWrk(envelope);
	const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
	const workspaceSalt = keys.bik.toString('hex');

	const keyEnvelope = {
		encryptedWrk: envelope.encryptedWrk.toString('base64'),
		kmsContext: envelope.kmsContext,
		wrkVersion: envelope.wrkVersion,
	};

	// Query all contacts for the workspace
	const workspaceContacts = await db
		.select({ id: contacts.id })
		.from(contacts)
		.where(eq(contacts.workspaceId, workspaceId));

	let contactsProcessed = 0;

	for (const contact of workspaceContacts) {
		const contactId = contact.id;

		// getMessagesByContact decrypts via withKeys(envelope) internally
		const msgs = await getMessagesByContact(workspaceId, contactId, envelope, { limit: 200 });

		if (msgs.length === 0) continue;

		// Messages come newest-first — reverse for chronological order
		const chronological = msgs.reverse();

		// Map to AI pipeline format and re-encrypt for BullMQ payload (SEC-006)
		const encryptedMessages = chronological
			.filter((m): m is typeof m & { text: string } => Boolean(m.text))
			.map((m) => ({
				role: m.isOutgoing ? ('user' as const) : ('assistant' as const),
				content: encrypt(m.text, keys.dek),
				timestamp: m.sentAt.toISOString(),
			}));

		if (encryptedMessages.length === 0) continue;

		await scheduleAIPipeline(
			userId,
			contactId,
			workspaceId,
			keyEnvelope,
			encryptedMessages,
			workspaceSalt,
		);

		console.log(
			`[admin] Reprocessing contact=${contactId.slice(0, 8)} (${encryptedMessages.length} messages)`,
		);

		contactsProcessed++;
	}

	console.log(
		`[admin] Reprocess complete: ${contactsProcessed} contacts queued for workspace=${workspaceId.slice(0, 8)}`,
	);

	return c.json({ status: 'queued', contactsProcessed });
});

/**
 * Trigger nightly knowledge extraction manually (cost-optimized pipeline).
 * Only processes contacts with new messages since last extraction.
 * Uses embedding-first matching + Haiku LLM with a budget cap.
 */
admin.post('/extract-knowledge', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const { runNightlyExtraction } = await import('../queues/knowledge-cron');
	// Run async — don't block the HTTP response
	runNightlyExtraction().catch((err) => {
		console.error('[admin] Knowledge extraction failed:', (err as Error).message);
	});

	return c.json({ status: 'started' });
});

admin.post('/embed', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const { text } = await c.req.json<{ text: string }>();
	if (!text || text.length > 2000) {
		return c.json({ error: 'text is required (max 2000 chars)' }, 400);
	}

	const { generateEmbedding } = await import('../ai/embeddings');
	const embedding = await generateEmbedding(text);
	return c.json({ embedding });
});

/**
 * POST /admin/trigger-health
 *
 * Triggers health scoring for a specific workspace or all workspaces.
 * The worker already runs this on a 24h setInterval — this endpoint
 * allows on-demand triggering (e.g. after a large sync or backfill).
 */
admin.post('/trigger-health', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = (await c.req.json<{ workspaceId?: string }>().catch(() => ({}))) as {
		workspaceId?: string;
	};

	if (body.workspaceId) {
		const job = await healthScoringQueue.add('compute', { workspaceId: body.workspaceId });
		console.log(
			`[admin] Enqueued health-scoring job=${job.id} for workspace=${body.workspaceId.slice(0, 8)}`,
		);
		return c.json({ status: 'queued', jobId: job.id, workspaceId: body.workspaceId });
	}

	// No workspaceId — queue for all workspaces
	const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);
	const jobIds: string[] = [];

	for (const ws of allWorkspaces) {
		const job = await healthScoringQueue.add('compute', { workspaceId: ws.id });
		jobIds.push(job.id ?? '');
	}

	console.log(`[admin] Enqueued health-scoring for ${allWorkspaces.length} workspaces`);
	return c.json({ status: 'queued', workspaceCount: allWorkspaces.length, jobIds });
});

/**
 * POST /admin/trigger-sync
 *
 * Triggers a Telegram sync for a specific user/workspace pair.
 * The worker already runs periodic sync every 15 minutes — this endpoint
 * allows on-demand triggering (e.g. after onboarding or debugging).
 */
admin.post('/trigger-sync', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{ workspaceId: string; userId: string }>();
	if (!body.workspaceId || !body.userId) {
		return c.json({ error: 'workspaceId and userId are required' }, 400);
	}

	const job = await syncQueue.add(
		'sync-contacts',
		{ userId: body.userId, workspaceId: body.workspaceId },
		{
			attempts: 3,
			backoff: { type: 'exponential', delay: 5000 },
			removeOnComplete: true,
			removeOnFail: false,
		},
	);

	console.log(
		`[admin] Enqueued sync job=${job.id} for workspace=${body.workspaceId.slice(0, 8)} user=${body.userId.slice(0, 8)}`,
	);

	return c.json({ status: 'queued', jobId: job.id, workspaceId: body.workspaceId });
});

/**
 * POST /admin/dedup-memories
 *
 * Deduplicates memories by (workspace_id, contact_id, category, content_sanitized).
 * Keeps the oldest memory per group (by created_at) and deletes duplicates.
 * Optionally scoped to a single workspace.
 */
admin.post('/dedup-memories', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = (await c.req.json<{ workspaceId?: string }>().catch(() => ({}))) as {
		workspaceId?: string;
	};

	const whereClause = body.workspaceId
		? sql`WHERE content_sanitized IS NOT NULL AND workspace_id = ${body.workspaceId}`
		: sql`WHERE content_sanitized IS NOT NULL`;

	// Count before
	const beforeResult = (await db.execute(
		sql`SELECT count(*) AS total FROM memories`,
	)) as unknown as Array<{
		total: string;
	}>;
	const totalBefore = Number(beforeResult[0]?.total ?? 0);

	// Delete duplicates, keeping oldest per group
	const deleteResult = (await db.execute(sql`
		DELETE FROM memories
		WHERE id IN (
			SELECT id FROM (
				SELECT id,
					ROW_NUMBER() OVER (
						PARTITION BY workspace_id, contact_id, category, content_sanitized
						ORDER BY created_at ASC
					) AS rn
				FROM memories
				${whereClause}
			) ranked
			WHERE rn > 1
		)
	`)) as unknown as Array<Record<string, unknown>> & { rowCount?: number };

	const deleted = (deleteResult as unknown as { rowCount?: number }).rowCount ?? 0;

	// Count after
	const afterResult = (await db.execute(
		sql`SELECT count(*) AS total FROM memories`,
	)) as unknown as Array<{
		total: string;
	}>;
	const totalAfter = Number(afterResult[0]?.total ?? 0);

	console.log(
		`[admin] Dedup memories: ${totalBefore} → ${totalAfter} (deleted ${deleted})${body.workspaceId ? ` workspace=${body.workspaceId.slice(0, 8)}` : ' (all)'}`,
	);

	return c.json({
		status: 'completed',
		totalBefore,
		totalAfter,
		deleted,
		workspaceId: body.workspaceId ?? 'all',
	});
});

export { admin };
