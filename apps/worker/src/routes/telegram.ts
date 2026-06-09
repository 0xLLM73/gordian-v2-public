import { createHmac } from 'node:crypto';
import { encrypt, generateSessionKek } from '@repo/crypto';
import {
	appendAuditLog,
	createTelegramImportRun,
	getAccessibleContactTelegramId,
	getTelegramImportRun,
	getUserTelegramAccountIds,
	hasCurrentTelegramConsent,
	isWorkspaceMember,
	requestTelegramImportCancel,
	requestTelegramImportPause,
	resumeTelegramImportRun,
	updateTelegramImportRunStatus,
} from '@repo/db';
import {
	TELEGRAM_CONSENT_VERSION,
	isAiAnalysisAvailable,
	redactSensitive,
	resolveTelegramSyncScope,
} from '@repo/shared';
import { verifyHandoffToken } from '@repo/shared/handoff-token';
import { Hono } from 'hono';
import { sendToUser, setAuthPending, terminateUser } from '../gramjs/thread';
import { validateInternalSecret } from '../middleware/auth';
import { syncQueue } from '../queues/sync';
import { enqueueTelegramHistoryImport } from '../queues/telegram-history-import';
import { connection } from '../redis';
import {
	isTelegramBotEnabled,
	isTelegramMtProtoEnabled,
	isTelegramMtProtoPerInteractionUnlockEnabled,
	isTelegramSendEnabled,
} from '../telegram-config';

/**
 * Worker-side Telegram auth routes.
 * These handle the actual GramJS Telegram API calls via Worker Thread.
 *
 * /telegram/send-code — Sends Telegram login code via GramJS
 * /telegram/verify-code — Verifies the code and returns session data
 * /telegram/sync-contacts — Enqueues contact sync job
 * /telegram/disconnect-session — Terminates the user's GramJS worker thread
 *
 * Auth: X-Internal-Secret header for service-to-service calls,
 * or handoff token for authenticated user requests.
 *
 * Note: send-code and verify-code use a phone-derived opaque pool key because
 * userId is not known yet during the initial auth flow.
 */

const telegram = new Hono();

/** SEC-022: Input validation patterns for defense-in-depth */
const PHONE_RE = /^\+\d{7,15}$/;
const CODE_RE = /^\d{1,8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TELEGRAM_ACCOUNT_ID_RE = /^\d{1,20}$/;
const AUTH_PHONE_CODE_TTL_SECONDS = 5 * 60;
type TelegramImportLocalAnalysisMode = 'deferred' | 'inline';
type TelegramHistoryImportMode = 'recent' | 'backfill';

function phoneSecret(): string {
	const secret =
		process.env.PHONE_REDIS_KEY_SECRET ??
		process.env.WORKER_INTERNAL_SECRET ??
		process.env.INTERNAL_AUTH_SECRET;
	if (!secret) {
		throw new Error(
			'PHONE_REDIS_KEY_SECRET, WORKER_INTERNAL_SECRET, or INTERNAL_AUTH_SECRET is required',
		);
	}
	return secret;
}

function phoneKey(phone: string): string {
	return `v1:${createHmac('sha256', phoneSecret()).update(phone).digest('hex').slice(0, 32)}`;
}

function authPhoneKey(phone: string): string {
	return `auth:phone:${phoneKey(phone)}`;
}

function ratePhoneKey(kind: 'send-code' | 'verify-code', phone: string): string {
	return `rate:${kind}:${phoneKey(phone)}`;
}

function authPoolKey(phone: string): string {
	return `telegram-auth:${phoneKey(phone)}`;
}

function telegramDisabled(message = 'Telegram MTProto integration is disabled') {
	return { error: message };
}

/**
 * Lua script for atomic rate limiting (SEC-021/058).
 * INCR and EXPIRE run in a single round-trip — prevents the race condition where
 * a crash between separate INCR + EXPIRE calls leaves a key with no TTL, permanently
 * blocking the user.
 */
const RATE_LIMIT_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

/** Atomically increment rate limit counter. Returns actual remaining TTL on rejection. */
async function atomicRateLimit(
	key: string,
	max: number,
	windowSecs: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
	const count = (await connection.eval(RATE_LIMIT_SCRIPT, 1, key, windowSecs)) as number;
	if (count > max) {
		const ttl = await connection.ttl(key);
		return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSecs };
	}
	return { allowed: true, retryAfter: 0 };
}

telegram.post('/send-code', async (c) => {
	if (!isTelegramMtProtoEnabled()) {
		return c.json(telegramDisabled(), 503);
	}

	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{ phone?: unknown }>();
	const phone = typeof body.phone === 'string' ? body.phone : '';
	if (!PHONE_RE.test(phone)) {
		return c.json({ error: 'Invalid phone number format' }, 400);
	}

	// Rate limit: 3 send-code requests per phone per 15 minutes (SEC-021).
	// Use HMAC-derived keys so Redis key listings do not disclose phone numbers.
	const authKey = authPhoneKey(phone);
	const poolKey = authPoolKey(phone);
	const rlSend = await atomicRateLimit(ratePhoneKey('send-code', phone), 3, 900);
	if (!rlSend.allowed) {
		return c.json({ error: 'Too many requests', retryAfter: rlSend.retryAfter }, 429);
	}

	try {
		// Use a phone-derived opaque pool key — userId is not known during initial auth flow.
		const result = await sendToUser<{
			type: string;
			phoneCodeHash: string;
		}>(poolKey, {
			type: 'send-code',
			phone,
		});

		// ASA-003: store hash server-side — never expose to client
		await connection.set(authKey, result.phoneCodeHash, 'EX', AUTH_PHONE_CODE_TTL_SECONDS);

		// ASA-006: mark thread as auth-pending — prevents eviction until verify-code
		setAuthPending(poolKey, true);

		return c.json({ success: true });
	} catch (err) {
		console.error('[send-code] Error:', redactSensitive(err));
		return c.json({ error: 'Failed to send code' }, 500);
	}
});

telegram.post('/verify-code', async (c) => {
	if (!isTelegramMtProtoEnabled()) {
		return c.json(telegramDisabled(), 503);
	}

	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	// ASA-003: phoneCodeHash no longer accepted from client — looked up from Redis below
	const body = await c.req.json<{
		phone?: unknown;
		code?: unknown;
		password?: unknown;
		userId?: unknown;
	}>();
	const phone = typeof body.phone === 'string' ? body.phone : '';
	const code = typeof body.code === 'string' ? body.code : '';
	const password = typeof body.password === 'string' ? body.password : undefined;
	const userId = typeof body.userId === 'string' ? body.userId : '';

	if (!PHONE_RE.test(phone) || !CODE_RE.test(code) || !UUID_RE.test(userId)) {
		return c.json({ error: 'Invalid phone, code, or userId format' }, 400);
	}
	if (password !== undefined && password.length > 256) {
		return c.json({ error: 'Invalid password' }, 400);
	}

	// Rate limit: 5 verify-code attempts per phone per 15 minutes (SEC-058)
	const authKey = authPhoneKey(phone);
	const poolKey = authPoolKey(phone);
	const rlVerify = await atomicRateLimit(ratePhoneKey('verify-code', phone), 5, 900);
	if (!rlVerify.allowed) {
		return c.json({ error: 'Too many requests', retryAfter: rlVerify.retryAfter }, 429);
	}

	// ASA-003: retrieve phoneCodeHash from Redis (stored by send-code, never from client)
	const phoneCodeHash = await connection.get(authKey);
	if (!phoneCodeHash) {
		return c.json({ error: 'Auth session expired. Please restart sign-in.' }, 400);
	}

	try {
		// Use the opaque phone-derived pool key — matches send-code for this auth flow.
		const result = await sendToUser<{
			type: string;
			telegramUserId: string;
			telegramSession: string;
		}>(poolKey, {
			type: 'verify-code',
			phone,
			code,
			phoneCodeHash,
			password, // For 2FA: SESSION_PASSWORD_NEEDED
		});

		// Success — clean up Redis hash and auth-pending flag
		await connection.del(authKey);
		setAuthPending(poolKey, false);

		// Clean up the phone-keyed auth thread — no longer needed after verification.
		// The user's ongoing session will use userId as pool key instead.
		terminateUser(poolKey).catch(() => {});

		// ASA-002: encrypt session before it leaves the worker process.
		// The web tier passes the authenticated Gordian userId so the KEK is always
		// encrypted with the correct KMS EncryptionContext — no DB lookup needed.
		const kekOwnerId = userId;
		const { plaintext: kek, ciphertextBlob } = await generateSessionKek(kekOwnerId);
		const encryptedSession = encrypt(result.telegramSession, kek);
		kek.fill(0); // Zero plaintext key immediately

		return c.json({
			telegramUserId: result.telegramUserId,
			encryptedSession,
			sessionKekEncrypted: ciphertextBlob.toString('base64'),
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Verification failed';

		// Handle 2FA requirement from GramJS — keep phoneCodeHash in Redis so the
		// follow-up request with password can reuse it.
		if (message.includes('SESSION_PASSWORD_NEEDED')) {
			await connection.expire(authKey, AUTH_PHONE_CODE_TTL_SECONDS);
			setAuthPending(poolKey, true);
			return c.json({ code: 'SESSION_PASSWORD_NEEDED' }, 400);
		}
		if (password !== undefined) {
			await connection.expire(authKey, AUTH_PHONE_CODE_TTL_SECONDS);
			setAuthPending(poolKey, true);
			console.error('[verify-code] 2FA password error:', redactSensitive(message));
			return c.json({ error: 'Invalid 2FA password' }, 400);
		}

		// Non-2FA failure — clean up hash and pending flag
		await connection.del(authKey);
		setAuthPending(poolKey, false);

		console.error('[verify-code] Error:', redactSensitive(message));
		return c.json({ error: 'Verification failed' }, 500);
	}
});

/** Trigger contact sync — requires handoff token (authenticated user) */
telegram.post('/sync-contacts', async (c) => {
	if (!isTelegramMtProtoEnabled()) {
		return c.json(telegramDisabled(), 503);
	}

	// Support both: handoff token (Bearer) and internal secret (X-Internal-Secret)
	const internalSecret = c.req.header('X-Internal-Secret');
	if (internalSecret) {
		if (!validateInternalSecret(internalSecret)) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		try {
			const body = await c.req.json<{
				userId?: unknown;
				workspaceId?: unknown;
				syncScope?: unknown;
				enableAiProcessing?: unknown;
				sourceAccountId?: unknown;
			}>();
			const userId = typeof body.userId === 'string' ? body.userId : '';
			const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
			const sourceAccountId = typeof body.sourceAccountId === 'string' ? body.sourceAccountId : '';
			const syncScope = resolveTelegramSyncScope(body.syncScope);
			const requestedAiProcessing = body.enableAiProcessing === true;
			if (requestedAiProcessing && !isAiAnalysisAvailable()) {
				return c.json(
					{
						error:
							'AI analysis is disabled. Configure local AI or set AI_PROCESSING_ENABLED=true to allow vendor egress.',
					},
					403,
				);
			}
			const enableAiProcessing =
				syncScope === 'contacts_only' ? false : requestedAiProcessing && isAiAnalysisAvailable();

			if (!UUID_RE.test(userId) || !UUID_RE.test(workspaceId)) {
				return c.json({ error: 'Invalid userId or workspaceId format' }, 400);
			}
			if (sourceAccountId && !TELEGRAM_ACCOUNT_ID_RE.test(sourceAccountId)) {
				return c.json({ error: 'Invalid sourceAccountId format' }, 400);
			}

			if (!(await isWorkspaceMember(workspaceId, userId))) {
				return c.json({ error: 'Unauthorized' }, 403);
			}

			if (sourceAccountId) {
				const accountIds = await getUserTelegramAccountIds(userId);
				if (!accountIds.includes(sourceAccountId)) {
					return c.json({ error: 'Selected Telegram account is not linked' }, 403);
				}
			}

			const syncJob = {
				userId,
				workspaceId,
				syncScope,
				enableAiProcessing,
				...(sourceAccountId ? { sourceAccountId } : {}),
			};
			await syncQueue.add('sync-contacts', syncJob);
			return c.json({ status: 'queued' });
		} catch (err) {
			console.error('[sync-contacts] Error:', redactSensitive(err));
			return c.json({ error: 'Sync failed' }, 500);
		}
	}

	const authHeader = c.req.header('Authorization');
	if (!authHeader?.startsWith('Bearer ')) {
		return c.json({ error: 'Missing bearer token' }, 401);
	}

	try {
		const token = authHeader.slice(7);
		const payload = await verifyHandoffToken(token, connection);

		if (payload.action !== 'sync-contacts') {
			return c.json({ error: 'Invalid action' }, 403);
		}

		if (!(await isWorkspaceMember(payload.workspaceId, payload.userId))) {
			return c.json({ error: 'Unauthorized' }, 403);
		}

		await syncQueue.add('sync-contacts', {
			userId: payload.userId,
			workspaceId: payload.workspaceId,
			syncScope: 'contacts_only',
			enableAiProcessing: false,
		});

		return c.json({ status: 'queued' });
	} catch {
		return c.json({ error: 'Invalid or expired token' }, 401);
	}
});

telegram.post('/history-import/start', async (c) => {
	if (!isTelegramMtProtoEnabled()) {
		return c.json(telegramDisabled(), 503);
	}

	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	try {
		const body = await c.req.json<{
			userId?: unknown;
			workspaceId?: unknown;
			sourceAccountId?: unknown;
			largeImportConfirmed?: unknown;
			localAnalysisMode?: unknown;
			importMode?: unknown;
		}>();
		const userId = typeof body.userId === 'string' ? body.userId : '';
		const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
		const sourceAccountId = typeof body.sourceAccountId === 'string' ? body.sourceAccountId : '';
		const largeImportConfirmed = body.largeImportConfirmed === true;
		const localAnalysisMode: TelegramImportLocalAnalysisMode =
			body.localAnalysisMode === 'inline' ? 'inline' : 'deferred';
		const importMode: TelegramHistoryImportMode =
			body.importMode === 'backfill' ? 'backfill' : 'recent';

		if (
			!UUID_RE.test(userId) ||
			!UUID_RE.test(workspaceId) ||
			!TELEGRAM_ACCOUNT_ID_RE.test(sourceAccountId)
		) {
			return c.json({ error: 'Invalid userId, workspaceId, or sourceAccountId format' }, 400);
		}
		if (!largeImportConfirmed) {
			return c.json({ error: 'Large import confirmation is required' }, 400);
		}

		if (!(await isWorkspaceMember(workspaceId, userId))) {
			return c.json({ error: 'Unauthorized' }, 403);
		}

		const accountIds = await getUserTelegramAccountIds(userId);
		if (!accountIds.includes(sourceAccountId)) {
			return c.json({ error: 'Selected Telegram account is not linked' }, 403);
		}

		const hasConsent = await hasCurrentTelegramConsent(
			userId,
			workspaceId,
			TELEGRAM_CONSENT_VERSION,
		);
		if (!hasConsent) {
			return c.json({ error: 'Telegram import consent is required' }, 403);
		}

		const run = await createTelegramImportRun({ workspaceId, userId, sourceAccountId });
		if (run.status === 'queued') {
			try {
				await enqueueTelegramHistoryImport({
					runId: run.id,
					userId,
					workspaceId,
					sourceAccountId,
					localAnalysisMode,
					importMode,
				});
			} catch (err) {
				await updateTelegramImportRunStatus(workspaceId, run.id, 'failed', {
					errorCode: 'TELEGRAM_IMPORT_ENQUEUE_FAILED',
					errorMessage: 'Telegram history import could not be queued. Please try again.',
				}).catch(() => {});
				throw err;
			}
		}

		return c.json({ status: run.status, importRunId: run.id });
	} catch (err) {
		console.error('[history-import/start] Error:', redactSensitive(err));
		return c.json({ error: 'Failed to start Telegram import' }, 500);
	}
});

telegram.post('/history-import/:runId/pause', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const runId = c.req.param('runId');
	const body = await c.req.json<{ userId?: unknown; workspaceId?: unknown }>();
	const userId = typeof body.userId === 'string' ? body.userId : '';
	const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
	if (!UUID_RE.test(runId) || !UUID_RE.test(userId) || !UUID_RE.test(workspaceId)) {
		return c.json({ error: 'Invalid runId, userId, or workspaceId format' }, 400);
	}
	if (!(await isWorkspaceMember(workspaceId, userId))) {
		return c.json({ error: 'Unauthorized' }, 403);
	}

	const updated = await requestTelegramImportPause(workspaceId, userId, runId);
	const run = updated ?? (await getTelegramImportRun(workspaceId, runId));
	if (!run || run.userId !== userId) return c.json({ error: 'Import run not found' }, 404);
	return c.json({ status: run.status, importRunId: runId });
});

telegram.post('/history-import/:runId/resume', async (c) => {
	if (!isTelegramMtProtoEnabled()) {
		return c.json(telegramDisabled(), 503);
	}

	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const runId = c.req.param('runId');
	const body = await c.req.json<{
		userId?: unknown;
		workspaceId?: unknown;
		localAnalysisMode?: unknown;
		importMode?: unknown;
	}>();
	const userId = typeof body.userId === 'string' ? body.userId : '';
	const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
	const localAnalysisMode: TelegramImportLocalAnalysisMode =
		body.localAnalysisMode === 'inline' ? 'inline' : 'deferred';
	const importMode: TelegramHistoryImportMode =
		body.importMode === 'backfill' ? 'backfill' : 'recent';
	if (!UUID_RE.test(runId) || !UUID_RE.test(userId) || !UUID_RE.test(workspaceId)) {
		return c.json({ error: 'Invalid runId, userId, or workspaceId format' }, 400);
	}
	if (!(await isWorkspaceMember(workspaceId, userId))) {
		return c.json({ error: 'Unauthorized' }, 403);
	}
	const hasConsent = await hasCurrentTelegramConsent(userId, workspaceId, TELEGRAM_CONSENT_VERSION);
	if (!hasConsent) {
		return c.json({ error: 'Telegram import consent is required' }, 403);
	}

	const run = await resumeTelegramImportRun(workspaceId, userId, runId);
	if (!run) return c.json({ error: 'Import run is not paused' }, 409);

	await enqueueTelegramHistoryImport({
		runId: run.id,
		userId,
		workspaceId,
		sourceAccountId: run.sourceAccountId,
		localAnalysisMode,
		importMode,
	});
	return c.json({ status: run.status, importRunId: run.id });
});

telegram.post('/history-import/:runId/cancel', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const runId = c.req.param('runId');
	const body = await c.req.json<{ userId?: unknown; workspaceId?: unknown }>();
	const userId = typeof body.userId === 'string' ? body.userId : '';
	const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
	if (!UUID_RE.test(runId) || !UUID_RE.test(userId) || !UUID_RE.test(workspaceId)) {
		return c.json({ error: 'Invalid runId, userId, or workspaceId format' }, 400);
	}
	if (!(await isWorkspaceMember(workspaceId, userId))) {
		return c.json({ error: 'Unauthorized' }, 403);
	}

	const current = await getTelegramImportRun(workspaceId, runId);
	if (!current || current.userId !== userId) {
		return c.json({ error: 'Import run not found' }, 404);
	}
	const updated = await requestTelegramImportCancel(workspaceId, userId, runId);
	if (current.status === 'paused') {
		await updateTelegramImportRunStatus(workspaceId, runId, 'cancelled');
		return c.json({ status: 'cancelled', importRunId: runId });
	}
	return c.json({ status: updated?.status ?? current.status, importRunId: runId });
});

/**
 * Terminate the user's GramJS worker thread and release their session.
 * Called by the web app when the user revokes Telegram access.
 */
telegram.post('/disconnect-session', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{ userId?: unknown }>();
	const userId = typeof body.userId === 'string' ? body.userId : '';
	if (!UUID_RE.test(userId)) {
		return c.json({ error: 'Invalid userId format' }, 400);
	}

	await terminateUser(userId);
	console.log('[telegram] Disconnected session for user');
	return c.json({ status: 'disconnected' });
});

/**
 * Send a "new session linked" notification to the user via Bot API.
 * Called by the web app when an existing Telegram account re-authenticates (P2 security).
 */
telegram.post('/notify-session', async (c) => {
	if (!isTelegramBotEnabled()) {
		return c.json(telegramDisabled('Telegram Bot API integration is disabled'), 503);
	}
	if (!isTelegramSendEnabled()) {
		return c.json(telegramDisabled('Telegram message sending is disabled'), 503);
	}

	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json<{ telegramUserId?: unknown }>();
	const telegramUserId = typeof body.telegramUserId === 'string' ? body.telegramUserId : '';
	if (!/^\d{1,20}$/.test(telegramUserId)) {
		return c.json({ error: 'Invalid telegramUserId format' }, 400);
	}

	const botToken = process.env.BOT_TOKEN;
	if (!botToken) {
		console.error('[notify-session] BOT_TOKEN not set');
		return c.json({ error: 'Bot not configured' }, 500);
	}

	try {
		const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: telegramUserId,
				text: "🔐 A new Gordian session was just linked to your account. If this wasn't you, open Telegram Settings → Devices and terminate the unknown session.",
				parse_mode: 'HTML',
			}),
		});

		if (!res.ok) {
			// Non-critical — don't fail the auth flow if notification fails
			console.warn('[notify-session] Bot API error:', res.status);
		}

		return c.json({ sent: true });
	} catch (err) {
		console.error('[notify-session] Error:', redactSensitive(err));
		return c.json({ sent: false });
	}
});

/**
 * Send a Telegram message via GramJS with 7-layer safety architecture:
 * 1. Internal secret auth
 * 2. Input validation
 * 3. Feature flag gates (global kill switch + workspace-level)
 * 4. Idempotency dedup (Redis SETNX, 5-min TTL)
 * 5. Rate limits: 5/contact/hr, 20/workspace/hr, 50/workspace/day
 * 6. Cooldown: 30s between messages to same contact
 * 7. Synchronous RPC via sendToUser() — no BullMQ, no retries
 */
telegram.post('/send-message', async (c) => {
	if (!isTelegramMtProtoEnabled() || !isTelegramSendEnabled()) {
		return c.json(telegramDisabled('Telegram message sending is disabled'), 503);
	}
	if (isTelegramMtProtoPerInteractionUnlockEnabled()) {
		return c.json(
			telegramDisabled(
				'Telegram message sending is disabled while per-read MTProto unlock is enforced',
			),
			503,
		);
	}

	// 1. Auth: internal secret required
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const body = await c.req.json();
	const { userId, workspaceId, contactId, contactTelegramId, text, idempotencyKey } = body;

	// 2. Input validation
	if (!UUID_RE.test(userId) || !UUID_RE.test(workspaceId) || !UUID_RE.test(contactId)) {
		return c.json({ error: 'Invalid UUID' }, 400);
	}
	if (!text || typeof text !== 'string' || text.length > 4096) {
		return c.json({ error: 'Invalid message text' }, 400);
	}
	if (!idempotencyKey || typeof idempotencyKey !== 'string' || !UUID_RE.test(idempotencyKey)) {
		return c.json({ error: 'Invalid idempotency key' }, 400);
	}
	if (
		!contactTelegramId ||
		typeof contactTelegramId !== 'string' ||
		!/^\d{1,20}$/.test(contactTelegramId)
	) {
		return c.json({ error: 'Invalid contactTelegramId' }, 400);
	}

	// 3. Feature flag gate (dynamic import to avoid Biome stripping)
	const { isFeatureEnabled } = await import('@repo/db');
	const killSwitch = await isFeatureEnabled('telegram_send_global_kill');
	if (killSwitch) return c.json({ error: 'Message sending is disabled' }, 503);
	const enabled = await isFeatureEnabled('telegram_send_enabled', workspaceId);
	if (!enabled) return c.json({ error: 'Message sending not enabled for workspace' }, 403);

	const dbTelegramId = await getAccessibleContactTelegramId(workspaceId, userId, contactId);
	if (!dbTelegramId || dbTelegramId !== contactTelegramId) {
		return c.json({ error: 'Contact not found' }, 404);
	}

	// 4. Idempotency dedup (Redis SETNX, 5-min TTL)
	const dedupKey = `tg:send:dedup:${idempotencyKey}`;
	const wasSet = await connection.set(dedupKey, '1', 'EX', 300, 'NX');
	if (!wasSet) return c.json({ error: 'Duplicate request', deduplicated: true }, 409);

	// 5. Rate limits (any failure = reject)
	const rl1 = await atomicRateLimit(`tg:send:contact:${workspaceId}:${contactId}`, 5, 3600);
	if (!rl1.allowed)
		return c.json({ error: 'Rate limit: max 5/contact/hour', retryAfter: rl1.retryAfter }, 429);

	const rl2 = await atomicRateLimit(`tg:send:hour:${workspaceId}`, 20, 3600);
	if (!rl2.allowed)
		return c.json({ error: 'Rate limit: max 20/hour', retryAfter: rl2.retryAfter }, 429);

	const rl3 = await atomicRateLimit(`tg:send:day:${workspaceId}`, 50, 86400);
	if (!rl3.allowed)
		return c.json({ error: 'Rate limit: max 50/day', retryAfter: rl3.retryAfter }, 429);

	// 6. Cooldown: min 30s between messages to same contact
	const cooldownKey = `tg:send:cooldown:${workspaceId}:${contactId}`;
	const cooldownSet = await connection.set(cooldownKey, '1', 'EX', 30, 'NX');
	if (!cooldownSet) {
		const ttl = await connection.ttl(cooldownKey);
		return c.json(
			{ error: 'Cooldown: 30s between messages to same contact', retryAfter: ttl },
			429,
		);
	}

	// 7. Send via GramJS (synchronous RPC — no BullMQ, no retries)
	try {
		const result = await sendToUser(userId, {
			type: 'send-message',
			contactTelegramId,
			text,
		});

		// SEC-SEND-300: audit log for outbound message send (fire-and-forget)
		appendAuditLog({
			workspaceId,
			actorType: 'user',
			actorId: userId,
			action: 'send',
			resourceType: 'message',
			resourceId: contactId,
			metadata: { idempotencyKey, telegramRecipient: 'present' },
		});

		return c.json({ success: true, messageId: (result as { messageId?: number }).messageId });
	} catch (err) {
		console.error('[send-message] GramJS error:', redactSensitive(err));
		return c.json({ error: 'Send failed' }, 502);
	}
});

export { telegram };
