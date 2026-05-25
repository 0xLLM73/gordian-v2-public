import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { deriveKeys, encrypt, unwrapWrk } from '@repo/crypto';
import {
	appendAuditLog,
	contacts,
	db,
	eq,
	getMessageCount,
	getMessagesByContact,
	hasUserAiAnalysisConsent,
	isWorkspaceMember,
	sql,
	workspaces,
} from '@repo/db';
import { getKnowledgeEmbeddingRuntime, isAiProcessingEnabled, redactSensitive } from '@repo/shared';
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

const ADMIN_REPROCESS_CONFIRM_TTL_MS = 10 * 60 * 1000;

function getAdminReprocessConfirmSecret(): string {
	const secret =
		process.env.ADMIN_AI_REPROCESS_CONFIRM_SECRET ??
		process.env.WORKER_INTERNAL_SECRET ??
		process.env.INTERNAL_AUTH_SECRET;
	if (!secret) {
		throw new Error(
			'ADMIN_AI_REPROCESS_CONFIRM_SECRET, WORKER_INTERNAL_SECRET, or INTERNAL_AUTH_SECRET is required',
		);
	}
	return secret;
}

function signAdminReprocessConfirmToken(payload: {
	batchSize: number;
	contactLimit: number;
	exp: number;
	userId: string;
	workspaceId: string;
}): string {
	const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const signature = createHmac('sha256', getAdminReprocessConfirmSecret())
		.update(encoded)
		.digest('base64url');
	return `${encoded}.${signature}`;
}

function safeEqualString(a: string, b: string): boolean {
	const aBuf = Buffer.from(a);
	const bBuf = Buffer.from(b);
	return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

function verifyAdminReprocessConfirmToken(
	token: unknown,
	expected: { batchSize: number; contactLimit: number; userId: string; workspaceId: string },
): boolean {
	if (typeof token !== 'string') return false;
	const [encoded, signature] = token.split('.');
	if (!encoded || !signature) return false;
	const expectedSignature = createHmac('sha256', getAdminReprocessConfirmSecret())
		.update(encoded)
		.digest('base64url');
	if (!safeEqualString(signature, expectedSignature)) return false;

	try {
		const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<{
			batchSize: number;
			contactLimit: number;
			exp: number;
			userId: string;
			workspaceId: string;
		}>;
		return (
			payload.workspaceId === expected.workspaceId &&
			payload.userId === expected.userId &&
			payload.batchSize === expected.batchSize &&
			payload.contactLimit === expected.contactLimit &&
			typeof payload.exp === 'number' &&
			payload.exp >= Date.now()
		);
	} catch {
		return false;
	}
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
		contactLimit?: number;
		confirm?: boolean;
		confirmToken?: string;
		dryRun?: boolean;
	}>();

	const { workspaceId, userId } = body;
	if (!workspaceId || !userId) {
		return c.json({ error: 'workspaceId and userId are required' }, 400);
	}
	if (process.env.ADMIN_AI_REPROCESS_ENABLED !== 'true') {
		return c.json(
			{ error: 'Admin AI reprocess is disabled. Set ADMIN_AI_REPROCESS_ENABLED=true.' },
			403,
		);
	}
	if (!isAiProcessingEnabled()) {
		return c.json(
			{
				error: 'AI processing is disabled. Set AI_PROCESSING_ENABLED=true to allow vendor egress.',
			},
			403,
		);
	}
	if (!(await isWorkspaceMember(workspaceId, userId))) {
		return c.json({ error: 'User is not a member of this workspace.' }, 403);
	}
	if (!(await hasUserAiAnalysisConsent(userId, workspaceId))) {
		return c.json({ error: 'AI analysis consent is required for this user/workspace.' }, 403);
	}

	const batchSize = Math.min(Math.max(Number(body.batchSize ?? 200), 1), 200);
	const contactLimit = Math.min(Math.max(Number(body.contactLimit ?? 25), 1), 100);
	const dryRun = body.dryRun === true;
	if (!dryRun && body.confirm !== true) {
		return c.json(
			{ error: 'Run with dryRun=true first, then confirm=true with confirmToken to queue jobs.' },
			400,
		);
	}

	// Query all contacts for the workspace
	const workspaceContacts = await db
		.select({ id: contacts.id })
		.from(contacts)
		.where(eq(contacts.workspaceId, workspaceId))
		.limit(contactLimit);

	if (dryRun) {
		let wouldProcessContacts = 0;
		let wouldProcessMessages = 0;
		for (const contact of workspaceContacts) {
			const count = Math.min(await getMessageCount(workspaceId, contact.id), batchSize);
			if (count === 0) continue;
			wouldProcessContacts++;
			wouldProcessMessages += count;
		}

		return c.json({
			status: 'dry_run',
			workspaceId,
			contactLimit,
			batchSize,
			wouldProcessContacts,
			wouldProcessMessages,
			confirmToken: signAdminReprocessConfirmToken({
				workspaceId,
				userId,
				batchSize,
				contactLimit,
				exp: Date.now() + ADMIN_REPROCESS_CONFIRM_TTL_MS,
			}),
		});
	}

	if (
		!verifyAdminReprocessConfirmToken(body.confirmToken, {
			workspaceId,
			userId,
			batchSize,
			contactLimit,
		})
	) {
		return c.json({ error: 'Valid dry-run confirmToken is required to queue jobs.' }, 400);
	}

	// Resolve and unwrap only after dry-run/confirmation gates pass.
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

	let contactsProcessed = 0;
	let messagesQueued = 0;

	for (const contact of workspaceContacts) {
		const contactId = contact.id;

		// getMessagesByContact decrypts via withKeys(envelope) internally
		const msgs = await getMessagesByContact(workspaceId, contactId, envelope, { limit: batchSize });

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
		messagesQueued += encryptedMessages.length;
	}

	console.log(
		`[admin] Reprocess complete: ${contactsProcessed} contacts queued for workspace=${workspaceId.slice(0, 8)}`,
	);
	appendAuditLog({
		workspaceId,
		actorType: 'system',
		actorId: userId,
		action: 'generate',
		resourceType: 'message',
		metadata: {
			operation: 'admin_ai_reprocess',
			contactsProcessed,
			messagesQueued,
			batchSize,
			contactLimit,
		},
	});

	return c.json({ status: 'queued', contactsProcessed, messagesQueued });
});

/**
 * Trigger nightly knowledge extraction manually (cost-optimized pipeline).
 * Only processes contacts with new messages since last extraction.
 * Uses embedding-first matching + the configured KG LLM with a budget cap.
 */
admin.post('/extract-knowledge', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = (await c.req
		.json<{
			workspaceId?: string;
			mode?: 'incremental' | 'evidence' | 'full';
			limit?: number;
			runInference?: boolean;
			waitForResult?: boolean;
		}>()
		.catch(() => ({}))) as {
		workspaceId?: string;
		mode?: 'incremental' | 'evidence' | 'full';
		limit?: number;
		runInference?: boolean;
		waitForResult?: boolean;
	};

	const { runKnowledgeAnalysis } = await import('../queues/knowledge-cron');
	const mode = body.mode ?? 'incremental';
	if (body.waitForResult) {
		if (!body.workspaceId) {
			return c.json({ error: 'workspaceId is required when waitForResult is true' }, 400);
		}

		try {
			const analysis = await runKnowledgeAnalysis({
				workspaceId: body.workspaceId,
				mode,
				limit: body.limit,
			});
			let inference: unknown = null;
			if (body.runInference) {
				const { runKnowledgeInference } = await import('../ai/knowledge-inference');
				inference = await runKnowledgeInference(body.workspaceId, { requireFeatureFlag: false });
			}

			return c.json({
				status: 'complete',
				mode,
				workspaceId: body.workspaceId,
				analysis,
				inference,
			});
		} catch (err) {
			console.error('[admin] Knowledge extraction failed:', redactSensitive(err));
			return c.json({ status: 'error', error: 'Knowledge extraction failed' }, 500);
		}
	}

	// Run async — don't block the HTTP response
	runKnowledgeAnalysis({
		workspaceId: body.workspaceId,
		mode,
		limit: body.limit,
	})
		.then(async () => {
			if (!body.runInference || !body.workspaceId) return;
			const { runKnowledgeInference } = await import('../ai/knowledge-inference');
			await runKnowledgeInference(body.workspaceId, { requireFeatureFlag: false });
		})
		.catch((err) => {
			console.error('[admin] Knowledge extraction failed:', redactSensitive(err));
		});

	return c.json({
		status: 'started',
		mode,
		workspaceId: body.workspaceId,
	});
});

admin.post('/build-manual-knowledge-evidence', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = (await c.req
		.json<{
			workspaceId?: string;
			nodeId?: string;
			limit?: number;
			maxEvidence?: number;
			runInference?: boolean;
			waitForResult?: boolean;
		}>()
		.catch(() => ({}))) as {
		workspaceId?: string;
		nodeId?: string;
		limit?: number;
		maxEvidence?: number;
		runInference?: boolean;
		waitForResult?: boolean;
	};

	if (!body.workspaceId || !body.nodeId) {
		return c.json({ error: 'workspaceId and nodeId are required' }, 400);
	}

	const { runManualKnowledgeEvidenceBuild } = await import('../queues/knowledge-cron');
	if (body.waitForResult) {
		try {
			const manualEvidence = await runManualKnowledgeEvidenceBuild({
				workspaceId: body.workspaceId,
				nodeId: body.nodeId,
				limit: body.limit,
				maxEvidence: body.maxEvidence,
			});
			let inference: unknown = null;
			if (body.runInference && !manualEvidence.skippedReason) {
				const { runKnowledgeInference } = await import('../ai/knowledge-inference');
				inference = await runKnowledgeInference(body.workspaceId, { requireFeatureFlag: false });
			}

			return c.json({
				status: manualEvidence.skippedReason ? 'skipped' : 'complete',
				workspaceId: body.workspaceId,
				nodeId: body.nodeId,
				manualEvidence,
				inference,
			});
		} catch (err) {
			console.error('[admin] Manual knowledge evidence build failed:', redactSensitive(err));
			return c.json({ status: 'error', error: 'Manual knowledge evidence build failed' }, 500);
		}
	}

	runManualKnowledgeEvidenceBuild({
		workspaceId: body.workspaceId,
		nodeId: body.nodeId,
		limit: body.limit,
		maxEvidence: body.maxEvidence,
	})
		.then(async (manualEvidence) => {
			if (!body.runInference || manualEvidence.skippedReason) return;
			const { runKnowledgeInference } = await import('../ai/knowledge-inference');
			await runKnowledgeInference(body.workspaceId as string, { requireFeatureFlag: false });
		})
		.catch((err) => {
			console.error('[admin] Manual knowledge evidence build failed:', redactSensitive(err));
		});

	return c.json({
		status: 'started',
		workspaceId: body.workspaceId,
		nodeId: body.nodeId,
	});
});

admin.post('/infer-knowledge', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = (await c.req
		.json<{
			workspaceId?: string;
		}>()
		.catch(() => ({}))) as {
		workspaceId?: string;
	};

	if (!body.workspaceId) {
		return c.json({ error: 'workspaceId is required' }, 400);
	}

	const { runKnowledgeInference } = await import('../ai/knowledge-inference');
	const result = await runKnowledgeInference(body.workspaceId, {
		requireFeatureFlag: false,
	});

	return c.json({
		status: result.skippedReason ? 'skipped' : 'complete',
		...result,
	});
});

admin.post('/knowledge-analysis/estimate', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{
		workspaceId?: string;
		mode?: 'incremental' | 'evidence' | 'full';
		limit?: number;
	}>();

	if (!body.workspaceId) {
		return c.json({ error: 'workspaceId is required' }, 400);
	}

	const { estimateKnowledgeAnalysis } = await import('../queues/knowledge-cron');
	const estimate = await estimateKnowledgeAnalysis(body.workspaceId, {
		mode: body.mode ?? 'incremental',
		limit: body.limit,
	});

	return c.json(estimate);
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
	const embeddingRuntime = getKnowledgeEmbeddingRuntime(process.env);
	if (!embeddingRuntime.isLocal && !isAiProcessingEnabled()) {
		return c.json(
			{
				error: 'AI processing is disabled. Set AI_PROCESSING_ENABLED=true to allow vendor egress.',
			},
			403,
		);
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
 * Periodic sync is disabled by default for personal-account safety. This endpoint
 * allows explicit on-demand triggering (e.g. after onboarding or debugging).
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
		{ userId: body.userId, workspaceId: body.workspaceId, syncScope: 'contacts_only' },
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
