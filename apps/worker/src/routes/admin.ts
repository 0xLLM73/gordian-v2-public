import { createHmac, timingSafeEqual } from 'node:crypto';
import {
	appendAuditLog,
	db,
	hasUserAiAnalysisConsent,
	isWorkspaceMember,
	sql,
	workspaces,
} from '@repo/db';
import {
	canRunCommitmentExtraction,
	getKnowledgeEmbeddingRuntime,
	isAiAnalysisAvailable,
	isAiProcessingEnabled,
	redactSensitive,
} from '@repo/shared';
import { Hono } from 'hono';
import { canRunConnectionDetection } from '../ai/connection-detection';
import { canRunIntroductionDetection } from '../ai/introduction-detection';
import { validateInternalSecret } from '../middleware/auth';
import { embeddingBackfillQueue } from '../queues/backfill';
import {
	estimateCommitmentReprocess,
	normalizeCommitmentReprocessBatchSize,
	normalizeCommitmentReprocessContactIds,
	normalizeCommitmentReprocessContactLimit,
	normalizeCommitmentReprocessMaxAgeDays,
	queueCommitmentReprocess,
} from '../queues/commitment-reprocess';
import {
	estimateConnectionReprocess,
	normalizeConnectionReprocessBatchSize,
	normalizeConnectionReprocessContactIds,
	normalizeConnectionReprocessContactLimit,
	normalizeConnectionReprocessMaxAgeDays,
	queueConnectionReprocess,
} from '../queues/connection-reprocess';
import { healthScoringQueue } from '../queues/health-scoring';
import {
	estimateIntroductionReprocess,
	normalizeIntroductionReprocessBatchSize,
	normalizeIntroductionReprocessChatIds,
	normalizeIntroductionReprocessChatLimit,
	normalizeIntroductionReprocessMaxAgeDays,
	queueIntroductionReprocess,
} from '../queues/introduction-reprocess';
import {
	cleanupResolvedRelationshipExtractionFailures,
	getRelationshipExtractionQueueStatus,
} from '../queues/relationship-extraction';
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

admin.get('/relationship-extraction-status', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const workspaceId = c.req.query('workspaceId');
	const userId = c.req.query('userId') || undefined;
	if (!workspaceId) {
		return c.json({ error: 'workspaceId is required' }, 400);
	}
	if (userId && !(await isWorkspaceMember(workspaceId, userId))) {
		return c.json({ error: 'User is not a member of this workspace.' }, 403);
	}

	const status = await getRelationshipExtractionQueueStatus({ workspaceId, userId });
	return c.json(status);
});

admin.post('/relationship-extraction-cleanup', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{
		workspaceId?: string;
		userId?: string;
		limit?: number;
	}>();
	const { workspaceId, userId } = body;
	if (!workspaceId) {
		return c.json({ error: 'workspaceId is required' }, 400);
	}
	if (userId && !(await isWorkspaceMember(workspaceId, userId))) {
		return c.json({ error: 'User is not a member of this workspace.' }, 403);
	}

	const result = await cleanupResolvedRelationshipExtractionFailures({
		workspaceId,
		userId,
		limit: body.limit,
	});
	return c.json(result);
});

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

const ADMIN_REPROCESS_CONFIRM_TTL_MS = 10 * 60 * 1000;

function isAdminAiReprocessEnabled(): boolean {
	const configured = process.env.ADMIN_AI_REPROCESS_ENABLED;
	if (configured === 'true') return true;
	if (configured === 'false') return false;
	return process.env.NODE_ENV !== 'production';
}

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
	contactIds?: string[];
	contactLimit: number;
	exp: number;
	maxAgeDays?: number;
	sourceAccountId?: string;
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
	expected: {
		batchSize: number;
		contactIds?: string[];
		contactLimit: number;
		maxAgeDays?: number;
		sourceAccountId?: string;
		userId: string;
		workspaceId: string;
	},
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
			contactIds?: string[];
			contactLimit: number;
			exp: number;
			maxAgeDays?: number;
			sourceAccountId?: string;
			userId: string;
			workspaceId: string;
		}>;
		return (
			payload.workspaceId === expected.workspaceId &&
			payload.userId === expected.userId &&
			payload.batchSize === expected.batchSize &&
			payload.contactLimit === expected.contactLimit &&
			JSON.stringify(payload.contactIds) === JSON.stringify(expected.contactIds) &&
			payload.maxAgeDays === expected.maxAgeDays &&
			payload.sourceAccountId === expected.sourceAccountId &&
			typeof payload.exp === 'number' &&
			payload.exp >= Date.now()
		);
	} catch {
		return false;
	}
}

function signAdminIntroductionReprocessConfirmToken(payload: {
	batchSize: number;
	chatIds?: string[];
	chatLimit: number;
	exp: number;
	maxAgeDays?: number;
	sourceAccountId?: string;
	userId: string;
	workspaceId: string;
}): string {
	const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const signature = createHmac('sha256', getAdminReprocessConfirmSecret())
		.update(encoded)
		.digest('base64url');
	return `${encoded}.${signature}`;
}

function verifyAdminIntroductionReprocessConfirmToken(
	token: unknown,
	expected: {
		batchSize: number;
		chatIds?: string[];
		chatLimit: number;
		maxAgeDays?: number;
		sourceAccountId?: string;
		userId: string;
		workspaceId: string;
	},
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
			chatIds?: string[];
			chatLimit: number;
			exp: number;
			maxAgeDays?: number;
			sourceAccountId?: string;
			userId: string;
			workspaceId: string;
		}>;
		return (
			payload.workspaceId === expected.workspaceId &&
			payload.userId === expected.userId &&
			payload.batchSize === expected.batchSize &&
			payload.chatLimit === expected.chatLimit &&
			JSON.stringify(payload.chatIds) === JSON.stringify(expected.chatIds) &&
			payload.maxAgeDays === expected.maxAgeDays &&
			payload.sourceAccountId === expected.sourceAccountId &&
			typeof payload.exp === 'number' &&
			payload.exp >= Date.now()
		);
	} catch {
		return false;
	}
}

function signAdminConnectionReprocessConfirmToken(payload: {
	batchSize: number;
	contactIds?: string[];
	contactLimit: number;
	exp: number;
	maxAgeDays?: number;
	sourceAccountId?: string;
	userId: string;
	workspaceId: string;
}): string {
	const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const signature = createHmac('sha256', getAdminReprocessConfirmSecret())
		.update(encoded)
		.digest('base64url');
	return `${encoded}.${signature}`;
}

function verifyAdminConnectionReprocessConfirmToken(
	token: unknown,
	expected: {
		batchSize: number;
		contactIds?: string[];
		contactLimit: number;
		maxAgeDays?: number;
		sourceAccountId?: string;
		userId: string;
		workspaceId: string;
	},
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
			contactIds?: string[];
			contactLimit: number;
			exp: number;
			maxAgeDays?: number;
			sourceAccountId?: string;
			userId: string;
			workspaceId: string;
		}>;
		return (
			payload.workspaceId === expected.workspaceId &&
			payload.userId === expected.userId &&
			payload.batchSize === expected.batchSize &&
			payload.contactLimit === expected.contactLimit &&
			JSON.stringify(payload.contactIds) === JSON.stringify(expected.contactIds) &&
			payload.maxAgeDays === expected.maxAgeDays &&
			payload.sourceAccountId === expected.sourceAccountId &&
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
		contactIds?: string[];
		sourceAccountId?: string;
		maxAgeDays?: number;
		confirm?: boolean;
		confirmToken?: string;
		dryRun?: boolean;
	}>();

	const { workspaceId, userId } = body;
	const sourceAccountId =
		typeof body.sourceAccountId === 'string' && body.sourceAccountId.trim().length > 0
			? body.sourceAccountId.trim()
			: undefined;
	const contactIds = normalizeCommitmentReprocessContactIds(body.contactIds);
	const maxAgeDays = normalizeCommitmentReprocessMaxAgeDays(body.maxAgeDays);
	if (!workspaceId || !userId) {
		return c.json({ error: 'workspaceId and userId are required' }, 400);
	}
	if (!isAdminAiReprocessEnabled()) {
		return c.json(
			{ error: 'Admin AI reprocess is disabled. Set ADMIN_AI_REPROCESS_ENABLED=true.' },
			403,
		);
	}
	if (!isAiAnalysisAvailable()) {
		return c.json(
			{
				error:
					'AI analysis is unavailable. Configure local AI analysis or set AI_PROCESSING_ENABLED=true.',
			},
			403,
		);
	}
	if (!canRunCommitmentExtraction()) {
		return c.json(
			{
				error: 'Commitment extraction is unavailable. Configure COMMITMENT_LLM_* and embeddings.',
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

	const batchSize = normalizeCommitmentReprocessBatchSize(body.batchSize);
	const contactLimit = normalizeCommitmentReprocessContactLimit(body.contactLimit);
	const dryRun = body.dryRun === true;
	if (!dryRun && body.confirm !== true) {
		return c.json(
			{ error: 'Run with dryRun=true first, then confirm=true with confirmToken to queue jobs.' },
			400,
		);
	}

	if (dryRun) {
		const estimate = await estimateCommitmentReprocess({
			workspaceId,
			userId,
			batchSize,
			contactLimit,
			contactIds,
			sourceAccountId,
			maxAgeDays,
		});

		return c.json({
			status: 'dry_run',
			workspaceId,
			contactLimit: estimate.contactLimit,
			batchSize: estimate.batchSize,
			wouldProcessContacts: estimate.wouldProcessContacts,
			wouldProcessMessages: estimate.wouldProcessMessages,
			maxAgeDays: estimate.maxAgeDays,
			confirmToken: signAdminReprocessConfirmToken({
				workspaceId,
				userId,
				batchSize: estimate.batchSize,
				contactLimit: estimate.contactLimit,
				contactIds,
				sourceAccountId,
				maxAgeDays: estimate.maxAgeDays,
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
			contactIds,
			sourceAccountId,
			maxAgeDays,
		})
	) {
		return c.json({ error: 'Valid dry-run confirmToken is required to queue jobs.' }, 400);
	}

	const queued = await queueCommitmentReprocess({
		workspaceId,
		userId,
		batchSize,
		contactLimit,
		contactIds,
		sourceAccountId,
		maxAgeDays,
		skipWorkspaceRelationshipDerivation: true,
	});

	console.log(
		`[admin] Reprocess complete: ${queued.contactsProcessed} contacts queued for workspace=${workspaceId.slice(0, 8)}`,
	);
	appendAuditLog({
		workspaceId,
		actorType: 'system',
		actorId: userId,
		action: 'generate',
		resourceType: 'message',
		metadata: {
			operation: 'admin_ai_reprocess',
			contactsProcessed: queued.contactsProcessed,
			messagesQueued: queued.messagesQueued,
			batchSize: queued.batchSize,
			contactLimit: queued.contactLimit,
			maxAgeDays: queued.maxAgeDays,
			contactIdsFiltered: Boolean(contactIds?.length),
			sourceAccountFiltered: Boolean(sourceAccountId),
		},
	});

	return c.json({
		status: 'queued',
		contactsProcessed: queued.contactsProcessed,
		messagesQueued: queued.messagesQueued,
		maxAgeDays: queued.maxAgeDays,
	});
});

admin.post('/reprocess-introductions', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{
		workspaceId: string;
		userId: string;
		batchSize?: number;
		chatLimit?: number;
		chatIds?: string[];
		sourceAccountId?: string;
		maxAgeDays?: number;
		confirm?: boolean;
		confirmToken?: string;
		dryRun?: boolean;
	}>();

	const { workspaceId, userId } = body;
	const sourceAccountId =
		typeof body.sourceAccountId === 'string' && body.sourceAccountId.trim().length > 0
			? body.sourceAccountId.trim()
			: undefined;
	const chatIds = normalizeIntroductionReprocessChatIds(body.chatIds);
	const maxAgeDays = normalizeIntroductionReprocessMaxAgeDays(body.maxAgeDays);
	if (!workspaceId || !userId) {
		return c.json({ error: 'workspaceId and userId are required' }, 400);
	}
	if (!isAdminAiReprocessEnabled()) {
		return c.json(
			{ error: 'Admin AI reprocess is disabled. Set ADMIN_AI_REPROCESS_ENABLED=true.' },
			403,
		);
	}
	if (!isAiAnalysisAvailable()) {
		return c.json(
			{
				error:
					'AI analysis is unavailable. Configure local AI analysis or set AI_PROCESSING_ENABLED=true.',
			},
			403,
		);
	}
	if (!canRunIntroductionDetection(process.env)) {
		return c.json(
			{
				error:
					'Introduction detection is unavailable. Configure local COMMITMENT_LLM_* or enable AI processing.',
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

	const batchSize = normalizeIntroductionReprocessBatchSize(body.batchSize);
	const chatLimit = normalizeIntroductionReprocessChatLimit(body.chatLimit);
	const dryRun = body.dryRun === true;
	if (!dryRun && body.confirm !== true) {
		return c.json(
			{ error: 'Run with dryRun=true first, then confirm=true with confirmToken to queue jobs.' },
			400,
		);
	}

	if (dryRun) {
		const estimate = await estimateIntroductionReprocess({
			workspaceId,
			userId,
			batchSize,
			chatLimit,
			chatIds,
			sourceAccountId,
			maxAgeDays,
		});

		return c.json({
			status: 'dry_run',
			workspaceId,
			chatLimit: estimate.chatLimit,
			batchSize: estimate.batchSize,
			wouldProcessChats: estimate.wouldProcessChats,
			wouldProcessMessages: estimate.wouldProcessMessages,
			maxAgeDays: estimate.maxAgeDays,
			confirmToken: signAdminIntroductionReprocessConfirmToken({
				workspaceId,
				userId,
				batchSize: estimate.batchSize,
				chatLimit: estimate.chatLimit,
				chatIds,
				sourceAccountId,
				maxAgeDays: estimate.maxAgeDays,
				exp: Date.now() + ADMIN_REPROCESS_CONFIRM_TTL_MS,
			}),
		});
	}

	if (
		!verifyAdminIntroductionReprocessConfirmToken(body.confirmToken, {
			workspaceId,
			userId,
			batchSize,
			chatLimit,
			chatIds,
			sourceAccountId,
			maxAgeDays,
		})
	) {
		return c.json({ error: 'Valid dry-run confirmToken is required to queue jobs.' }, 400);
	}

	const queued = await queueIntroductionReprocess({
		workspaceId,
		userId,
		batchSize,
		chatLimit,
		chatIds,
		sourceAccountId,
		maxAgeDays,
	});

	console.log(
		`[admin] Introduction reprocess complete: ${queued.chatsProcessed} chats queued for workspace=${workspaceId.slice(0, 8)}`,
	);
	appendAuditLog({
		workspaceId,
		actorType: 'system',
		actorId: userId,
		action: 'generate',
		resourceType: 'message',
		metadata: {
			operation: 'admin_intro_reprocess',
			chatsProcessed: queued.chatsProcessed,
			messagesQueued: queued.messagesQueued,
			batchSize: queued.batchSize,
			chatLimit: queued.chatLimit,
			maxAgeDays: queued.maxAgeDays,
			chatIdsFiltered: Boolean(chatIds?.length),
			sourceAccountFiltered: Boolean(sourceAccountId),
		},
	});

	return c.json({
		status: 'queued',
		chatsProcessed: queued.chatsProcessed,
		messagesQueued: queued.messagesQueued,
		maxAgeDays: queued.maxAgeDays,
	});
});

admin.post('/reprocess-connections', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{
		workspaceId: string;
		userId: string;
		batchSize?: number;
		contactLimit?: number;
		contactIds?: string[];
		sourceAccountId?: string;
		maxAgeDays?: number;
		confirm?: boolean;
		confirmToken?: string;
		dryRun?: boolean;
	}>();

	const { workspaceId, userId } = body;
	const sourceAccountId =
		typeof body.sourceAccountId === 'string' && body.sourceAccountId.trim().length > 0
			? body.sourceAccountId.trim()
			: undefined;
	const contactIds = normalizeConnectionReprocessContactIds(body.contactIds);
	const maxAgeDays = normalizeConnectionReprocessMaxAgeDays(body.maxAgeDays);
	if (!workspaceId || !userId) {
		return c.json({ error: 'workspaceId and userId are required' }, 400);
	}
	if (!isAdminAiReprocessEnabled()) {
		return c.json(
			{ error: 'Admin AI reprocess is disabled. Set ADMIN_AI_REPROCESS_ENABLED=true.' },
			403,
		);
	}
	if (!isAiAnalysisAvailable()) {
		return c.json(
			{
				error:
					'AI analysis is unavailable. Configure local AI analysis or set AI_PROCESSING_ENABLED=true.',
			},
			403,
		);
	}
	if (!canRunConnectionDetection(process.env)) {
		return c.json(
			{
				error:
					'Connection detection is unavailable. Configure local COMMITMENT_LLM_* or enable AI processing.',
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

	const batchSize = normalizeConnectionReprocessBatchSize(body.batchSize);
	const contactLimit = normalizeConnectionReprocessContactLimit(body.contactLimit);
	const dryRun = body.dryRun === true;
	if (!dryRun && body.confirm !== true) {
		return c.json(
			{ error: 'Run with dryRun=true first, then confirm=true with confirmToken to queue jobs.' },
			400,
		);
	}

	if (dryRun) {
		const estimate = await estimateConnectionReprocess({
			workspaceId,
			userId,
			batchSize,
			contactLimit,
			contactIds,
			sourceAccountId,
			maxAgeDays,
		});

		return c.json({
			status: 'dry_run',
			workspaceId,
			contactLimit: estimate.contactLimit,
			batchSize: estimate.batchSize,
			wouldProcessContacts: estimate.wouldProcessContacts,
			wouldProcessMessages: estimate.wouldProcessMessages,
			maxAgeDays: estimate.maxAgeDays,
			confirmToken: signAdminConnectionReprocessConfirmToken({
				workspaceId,
				userId,
				batchSize: estimate.batchSize,
				contactLimit: estimate.contactLimit,
				contactIds,
				sourceAccountId,
				maxAgeDays: estimate.maxAgeDays,
				exp: Date.now() + ADMIN_REPROCESS_CONFIRM_TTL_MS,
			}),
		});
	}

	if (
		!verifyAdminConnectionReprocessConfirmToken(body.confirmToken, {
			workspaceId,
			userId,
			batchSize,
			contactLimit,
			contactIds,
			sourceAccountId,
			maxAgeDays,
		})
	) {
		return c.json({ error: 'Valid dry-run confirmToken is required to queue jobs.' }, 400);
	}

	const queued = await queueConnectionReprocess({
		workspaceId,
		userId,
		batchSize,
		contactLimit,
		contactIds,
		sourceAccountId,
		maxAgeDays,
	});

	console.log(
		`[admin] Connection reprocess complete: ${queued.contactsProcessed} contacts queued for workspace=${workspaceId.slice(0, 8)}`,
	);
	appendAuditLog({
		workspaceId,
		actorType: 'system',
		actorId: userId,
		action: 'generate',
		resourceType: 'message',
		metadata: {
			operation: 'admin_connection_reprocess',
			contactsProcessed: queued.contactsProcessed,
			messagesQueued: queued.messagesQueued,
			batchSize: queued.batchSize,
			contactLimit: queued.contactLimit,
			maxAgeDays: queued.maxAgeDays,
			contactIdsFiltered: Boolean(contactIds?.length),
			sourceAccountFiltered: Boolean(sourceAccountId),
		},
	});

	return c.json({
		status: 'queued',
		contactsProcessed: queued.contactsProcessed,
		messagesQueued: queued.messagesQueued,
		maxAgeDays: queued.maxAgeDays,
	});
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
