import { encrypt, generateSessionKek } from '@repo/crypto';
import { appendAuditLog } from '@repo/db';
import { verifyHandoffToken } from '@repo/shared/handoff-token';
import { Hono } from 'hono';
import { sendToUser, setAuthPending, terminateUser } from '../gramjs/thread';
import { validateInternalSecret } from '../middleware/auth';
import { syncQueue } from '../queues/sync';
import { connection } from '../redis';
import {
	isTelegramBotEnabled,
	isTelegramMtProtoEnabled,
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
 * Note: send-code and verify-code use phone as the pool key because
 * userId is not known yet during the initial auth flow.
 */

const telegram = new Hono();

/** SEC-022: Input validation patterns for defense-in-depth */
const PHONE_RE = /^\+\d{7,15}$/;
const CODE_RE = /^\d{1,8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

	// Rate limit: 3 send-code requests per phone per 15 minutes (SEC-021)
	// Normalize phone to digits-only so +1234 and 1234 share the same counter (W1).
	const normalizedSendPhone = phone.replace(/[^0-9]/g, '');
	const rlSend = await atomicRateLimit(`rate:send-code:${normalizedSendPhone}`, 3, 900);
	if (!rlSend.allowed) {
		return c.json({ error: 'Too many requests', retryAfter: rlSend.retryAfter }, 429);
	}

	try {
		// Use phone as pool key — userId not yet known during initial auth flow
		const result = await sendToUser<{
			type: string;
			phoneCodeHash: string;
		}>(phone, {
			type: 'send-code',
			phone,
		});

		// ASA-003: store hash server-side — never expose to client
		await connection.set(`auth:phone:${phone}`, result.phoneCodeHash, 'EX', 180);

		// ASA-006: mark thread as auth-pending — prevents eviction until verify-code
		setAuthPending(phone, true);

		return c.json({ success: true });
	} catch (err) {
		console.error('[send-code] Error:', err instanceof Error ? err.message : err);
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
	const normalizedVerifyPhone = phone.replace(/[^0-9]/g, '');
	const rlVerify = await atomicRateLimit(`rate:verify-code:${normalizedVerifyPhone}`, 5, 900);
	if (!rlVerify.allowed) {
		return c.json({ error: 'Too many requests', retryAfter: rlVerify.retryAfter }, 429);
	}

	// ASA-003: retrieve phoneCodeHash from Redis (stored by send-code, never from client)
	const phoneCodeHash = await connection.get(`auth:phone:${phone}`);
	if (!phoneCodeHash) {
		return c.json({ error: 'Auth session expired. Please restart sign-in.' }, 400);
	}

	try {
		// Use phone as pool key — matches the send-code thread for this auth flow
		const result = await sendToUser<{
			type: string;
			telegramUserId: string;
			telegramSession: string;
		}>(phone, {
			type: 'verify-code',
			phone,
			code,
			phoneCodeHash,
			password, // For 2FA: SESSION_PASSWORD_NEEDED
		});

		// Success — clean up Redis hash and auth-pending flag
		await connection.del(`auth:phone:${phone}`);
		setAuthPending(phone, false);

		// Clean up the phone-keyed auth thread — no longer needed after verification.
		// The user's ongoing session will use userId as pool key instead.
		terminateUser(phone).catch(() => {});

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
			return c.json({ code: 'SESSION_PASSWORD_NEEDED' }, 400);
		}

		// Non-2FA failure — clean up hash and pending flag
		await connection.del(`auth:phone:${phone}`);
		setAuthPending(phone, false);

		console.error('[verify-code] Error:', message);
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
			const body = await c.req.json<{ userId?: unknown; workspaceId?: unknown }>();
			const userId = typeof body.userId === 'string' ? body.userId : '';
			const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';

			if (!UUID_RE.test(userId) || !UUID_RE.test(workspaceId)) {
				return c.json({ error: 'Invalid userId or workspaceId format' }, 400);
			}

			await syncQueue.add('sync-contacts', { userId, workspaceId });
			return c.json({ status: 'queued' });
		} catch (err) {
			console.error('[sync-contacts] Error:', err instanceof Error ? err.message : err);
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

		await syncQueue.add('sync-contacts', {
			userId: payload.userId,
			workspaceId: payload.workspaceId,
		});

		return c.json({ status: 'queued' });
	} catch {
		return c.json({ error: 'Invalid or expired token' }, 401);
	}
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
				text: "🔐 A new Gordian session was just linked to your account. If this wasn't you, type /revoke to disconnect immediately.",
				parse_mode: 'HTML',
			}),
		});

		if (!res.ok) {
			// Non-critical — don't fail the auth flow if notification fails
			console.warn('[notify-session] Bot API error:', res.status);
		}

		return c.json({ sent: true });
	} catch (err) {
		console.error('[notify-session] Error:', err instanceof Error ? err.message : err);
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
			metadata: { contactTelegramId, idempotencyKey },
		});

		return c.json({ success: true, messageId: (result as { messageId?: number }).messageId });
	} catch (err) {
		console.error('[send-message] GramJS error:', (err as Error).message);
		return c.json({ error: 'Send failed' }, 502);
	}
});

export { telegram };
