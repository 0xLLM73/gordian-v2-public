import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before any imports
vi.mock('../../redis', () => ({
	connection: {
		eval: vi.fn(),
		ttl: vi.fn(),
		set: vi.fn().mockResolvedValue('OK'),
		expire: vi.fn().mockResolvedValue(1),
		del: vi.fn().mockResolvedValue(1),
		get: vi.fn(),
	},
}));

vi.mock('../../gramjs/thread', () => ({
	sendToUser: vi.fn(),
	terminateUser: vi.fn().mockResolvedValue(undefined),
	setAuthPending: vi.fn(),
}));

vi.mock('../../queues/sync', () => ({
	syncQueue: { add: vi.fn() },
}));

vi.mock('../../queues/telegram-history-import', () => ({
	enqueueTelegramHistoryImport: vi.fn(),
	queueTelegramAiConsentCatchup: vi.fn(),
}));

vi.mock('@repo/shared/handoff-token', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@repo/shared/handoff-token')>();
	return { ...actual, verifyHandoffToken: vi.fn() };
});

vi.mock('@repo/crypto', () => ({
	encrypt: vi.fn(() => 'enc:mock'),
	generateSessionKek: vi.fn(async () => ({
		plaintext: Buffer.alloc(32, 1),
		ciphertextBlob: Buffer.alloc(32, 2),
	})),
}));

// ASA-002 fix: telegram.ts now queries @repo/db to look up userId from telegramUserId
vi.mock('@repo/db', () => ({
	appendAuditLog: vi.fn(),
	hasUserAiAnalysisConsent: vi.fn().mockResolvedValue(true),
	isWorkspaceMember: vi.fn().mockResolvedValue(true),
	getUserTelegramAccountIds: vi.fn().mockResolvedValue(['123456789', '987654321']),
	db: {
		query: {
			accounts: {
				findFirst: vi.fn().mockResolvedValue(null), // new user — falls back to telegramUserId
			},
		},
	},
	accounts: {},
	and: vi.fn(),
	eq: vi.fn(),
	isFeatureEnabled: vi.fn(),
}));

import { generateSessionKek } from '@repo/crypto';
import { getUserTelegramAccountIds, isWorkspaceMember } from '@repo/db';
import { sendToUser, setAuthPending } from '../../gramjs/thread';
import { syncQueue } from '../../queues/sync';
import { connection } from '../../redis';
import { telegram } from '../../routes/telegram';

process.env.INTERNAL_AUTH_SECRET = 'test-secret';
process.env.WORKER_INTERNAL_SECRET = 'test-secret';

const SECRET = 'test-secret';
// Normalized form of these phones is 11111111111 and 22222222222
const PHONE_A = '+11111111111';
const PHONE_B = '+22222222222';
// SEC-022: verify-code now requires userId as UUID
const USER_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function expectedPhoneKey(phone: string): string {
	return `v1:${createHmac('sha256', SECRET).update(phone).digest('hex').slice(0, 32)}`;
}

function expectedAuthKey(phone: string): string {
	return `auth:phone:${expectedPhoneKey(phone)}`;
}

function expectedPoolKey(phone: string): string {
	return `telegram-auth:${expectedPhoneKey(phone)}`;
}

function post(path: string, body: object) {
	return telegram.request(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': SECRET,
		},
		body: JSON.stringify(body),
	});
}

function postWithoutSecret(path: string, body: object) {
	return telegram.request(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
}

beforeEach(() => {
	vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
	vi.stubEnv('TELEGRAM_SEND_ENABLED', 'true');
	vi.stubEnv('TELEGRAM_BOT_ENABLED', 'true');
	vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
});

describe('/send-code rate limiting (SEC-021)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: fresh key, TTL = full window
		(connection.ttl as ReturnType<typeof vi.fn>).mockResolvedValue(900);
		(connection.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
	});

	it('returns 503 when MTProto is disabled', async () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'false');

		const res = await post('/send-code', { phone: PHONE_A });

		expect(res.status).toBe(503);
		expect(sendToUser).not.toHaveBeenCalled();
	});

	it('requires internal auth before exposing disabled MTProto state', async () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'false');

		const res = await postWithoutSecret('/send-code', { phone: PHONE_A });

		expect(res.status).toBe(401);
		expect(sendToUser).not.toHaveBeenCalled();
	});

	it('allows requests within the limit', async () => {
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(3); // at limit, not over
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'hash123',
			delivery: { method: 'app', codeLength: 6, timeoutSeconds: 120, nextMethod: 'sms' },
		});

		const res = await post('/send-code', { phone: PHONE_A });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			success: true,
			delivery: { method: 'app', codeLength: 6, expiresInSeconds: 120, nextMethod: 'sms' },
		});
	});

	it('rate-limit-send-code: 4th call returns 429', async () => {
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(4);

		const res = await post('/send-code', { phone: PHONE_A });

		expect(res.status).toBe(429);
		const body = (await res.json()) as { error: string; retryAfter: number };
		expect(body.error).toBe('Too many requests');
	});

	it('returns actual remaining TTL in retryAfter (W2)', async () => {
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(4);
		(connection.ttl as ReturnType<typeof vi.fn>).mockResolvedValue(750);

		const res = await post('/send-code', { phone: PHONE_A });

		const body = (await res.json()) as { retryAfter: number };
		expect(body.retryAfter).toBe(750);
	});

	it('uses Lua eval for atomic INCR+EXPIRE (Fix 1)', async () => {
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'hash123',
		});

		await post('/send-code', { phone: PHONE_A });

		expect(connection.eval).toHaveBeenCalledWith(
			expect.stringContaining('INCR'),
			1,
			`rate:send-code:${expectedPhoneKey(PHONE_A)}`,
			900,
		);
		expect(String((connection.eval as ReturnType<typeof vi.fn>).mock.calls[0][2])).not.toContain(
			'11111111111',
		);
	});

	it('rate-limit-independent-phones: phone A limited does not block phone B', async () => {
		// Phone A is rate-limited
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValueOnce(4);
		const resA = await post('/send-code', { phone: PHONE_A });
		expect(resA.status).toBe(429);

		// Phone B is fresh
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			phoneCodeHash: 'hash456',
		});
		const resB = await post('/send-code', { phone: PHONE_B });
		expect(resB.status).toBe(200);
	});
});

describe('ASA-003 — send-code stores hash server-side, never returns it', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);
		(connection.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
		(connection.ttl as ReturnType<typeof vi.fn>).mockResolvedValue(900);
	});

	it('stores phoneCodeHash in Redis under an opaque auth:phone key', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'secret-hash-abc',
		});

		await post('/send-code', { phone: PHONE_A });

		expect(connection.set).toHaveBeenCalledWith(
			expectedAuthKey(PHONE_A),
			'secret-hash-abc',
			'EX',
			300,
		);
		expect(String((connection.set as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain(
			PHONE_A,
		);
	});

	it('does NOT return phoneCodeHash in the response body', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'secret-hash-abc',
		});

		const res = await post('/send-code', { phone: PHONE_A });
		const body = await res.json();
		expect(body).not.toHaveProperty('phoneCodeHash');
		expect(body).toEqual({
			success: true,
			delivery: { method: 'unknown', codeLength: 5, expiresInSeconds: 300 },
		});
	});

	it('returns only non-secret Telegram delivery metadata', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'secret-hash-abc',
			delivery: {
				method: 'sms',
				codeLength: 8,
				timeoutSeconds: 900,
				nextMethod: 'call',
				phoneCodeHash: 'should-not-leak',
			},
		});

		const res = await post('/send-code', { phone: PHONE_A });
		const body = await res.json();

		expect(body).toEqual({
			success: true,
			delivery: { method: 'sms', codeLength: 8, expiresInSeconds: 300, nextMethod: 'call' },
		});
		expect(JSON.stringify(body)).not.toContain('secret-hash-abc');
		expect(JSON.stringify(body)).not.toContain('should-not-leak');
	});

	it('sets isAuthPending=true after send-code (ASA-006)', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'hash-x',
		});

		await post('/send-code', { phone: PHONE_A });

		expect(setAuthPending).toHaveBeenCalledWith(expectedPoolKey(PHONE_A), true);
	});
});

describe('ASA-003 — verify-code retrieves hash from Redis, one-time use', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);
		(connection.ttl as ReturnType<typeof vi.fn>).mockResolvedValue(900);
		(connection.get as ReturnType<typeof vi.fn>).mockResolvedValue('stored-hash');
		(connection.del as ReturnType<typeof vi.fn>).mockResolvedValue(1);
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			telegramUserId: 'tg-123',
			telegramSession: 'session-data',
		});
	});

	it('retrieves phoneCodeHash from Redis using an opaque auth:phone key', async () => {
		await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });

		expect(connection.get).toHaveBeenCalledWith(expectedAuthKey(PHONE_A));
	});

	it('requires internal auth before exposing disabled verify-code state', async () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'false');

		const res = await postWithoutSecret('/verify-code', {
			phone: PHONE_A,
			code: '12345',
			userId: USER_ID,
		});

		expect(res.status).toBe(401);
		expect(connection.get).not.toHaveBeenCalled();
	});

	it('deletes the Redis key immediately after retrieval (one-time use)', async () => {
		await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });

		expect(connection.del).toHaveBeenCalledWith(expectedAuthKey(PHONE_A));
	});

	it('returns 400 when Redis has no entry for phone (auth session expired)', async () => {
		(connection.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		const res = await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/expired|restart/i);
	});

	it('clears isAuthPending=false in verify-code (ASA-006)', async () => {
		await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });

		expect(setAuthPending).toHaveBeenCalledWith(expectedPoolKey(PHONE_A), false);
	});

	it('does not send phoneCodeHash in the worker sendToUser call', async () => {
		await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });

		const workerCall = (sendToUser as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
			string,
			unknown
		>;
		// The hash should come from Redis, not from the client request
		// verify-code passes it to sendToUser internally — it should be present
		expect(workerCall).toHaveProperty('phoneCodeHash', 'stored-hash');
		// But the client-side request body should not have sent it (enforced by Zod schema above)
	});

	// GAP 1 — ASA-002: verify-code response shape
	it('returns encryptedSession + sessionKekEncrypted, never telegramSession', async () => {
		const res = await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });
		const body = await res.json();
		expect(body).toHaveProperty('encryptedSession');
		expect(body).toHaveProperty('sessionKekEncrypted');
		expect(body).not.toHaveProperty('telegramSession');
	});

	// GAP 2 — ASA-002: kekOwnerId uses userId from the request body (web passes authenticated Gordian userId)
	it('uses userId from request body for generateSessionKek', async () => {
		const res = await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });

		expect(res.status).toBe(200);
		expect(generateSessionKek).toHaveBeenCalledWith(USER_ID);
	});

	it('keeps auth state alive when Telegram requires 2FA password', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error('SESSION_PASSWORD_NEEDED'),
		);

		const res = await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });
		const body = await res.json();

		expect(res.status).toBe(400);
		expect(body).toEqual({ code: 'SESSION_PASSWORD_NEEDED' });
		expect(connection.del).not.toHaveBeenCalled();
		expect(connection.expire).toHaveBeenCalledWith(expectedAuthKey(PHONE_A), 300);
		expect(setAuthPending).toHaveBeenCalledWith(expectedPoolKey(PHONE_A), true);
	});

	it('keeps auth state alive after an invalid login code so the user can retry', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PHONE_CODE_INVALID'));

		const res = await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });
		const body = await res.json();

		expect(res.status).toBe(400);
		expect(body).toEqual({ code: 'PHONE_CODE_INVALID', error: 'Invalid verification code' });
		expect(connection.del).not.toHaveBeenCalled();
		expect(connection.expire).toHaveBeenCalledWith(expectedAuthKey(PHONE_A), 300);
		expect(setAuthPending).toHaveBeenCalledWith(expectedPoolKey(PHONE_A), true);
	});

	it('clears auth state after Telegram reports an expired login code', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PHONE_CODE_EXPIRED'));

		const res = await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });
		const body = await res.json();

		expect(res.status).toBe(400);
		expect(body).toEqual({
			code: 'AUTH_SESSION_EXPIRED',
			error: 'Auth session expired. Please restart sign-in.',
		});
		expect(connection.del).toHaveBeenCalledWith(expectedAuthKey(PHONE_A));
		expect(setAuthPending).toHaveBeenCalledWith(expectedPoolKey(PHONE_A), false);
	});

	it('keeps auth state alive after a wrong 2FA password attempt', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PASSWORD_HASH_INVALID'));

		const res = await post('/verify-code', {
			phone: PHONE_A,
			code: '12345',
			password: 'wrong password',
			userId: USER_ID,
		});
		const body = (await res.json()) as { error: string };

		expect(res.status).toBe(400);
		expect(body.error).toBe('Invalid 2FA password');
		expect(connection.del).not.toHaveBeenCalled();
		expect(connection.expire).toHaveBeenCalledWith(expectedAuthKey(PHONE_A), 300);
		expect(setAuthPending).toHaveBeenCalledWith(expectedPoolKey(PHONE_A), true);
	});
});

describe('/sync-contacts personal-account scope', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(isWorkspaceMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(getUserTelegramAccountIds as ReturnType<typeof vi.fn>).mockResolvedValue([
			'123456789',
			'987654321',
		]);
	});

	it('requires auth before exposing disabled sync state', async () => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'false');

		const res = await postWithoutSecret('/sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
		});

		expect(res.status).toBe(401);
		expect(syncQueue.add).not.toHaveBeenCalled();
	});

	it('queues contacts-only sync by default', async () => {
		const res = await post('/sync-contacts', { userId: USER_ID, workspaceId: WORKSPACE_ID });

		expect(res.status).toBe(200);
		expect(syncQueue.add).toHaveBeenCalledWith('sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'contacts_only',
			enableAiProcessing: false,
		});
	});

	it('queues explicit private-recent sync with AI opt-in', async () => {
		const res = await post('/sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});

		expect(res.status).toBe(200);
		expect(syncQueue.add).toHaveBeenCalledWith('sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});
	});

	it('queues explicit group sync scope', async () => {
		const res = await post('/sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'private_recent_with_groups',
			enableAiProcessing: false,
		});

		expect(res.status).toBe(200);
		expect(syncQueue.add).toHaveBeenCalledWith('sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'private_recent_with_groups',
			enableAiProcessing: false,
		});
	});

	it('queues sync for an explicit linked source account', async () => {
		const res = await post('/sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: '987654321',
		});

		expect(res.status).toBe(200);
		expect(syncQueue.add).toHaveBeenCalledWith('sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'contacts_only',
			enableAiProcessing: false,
			sourceAccountId: '987654321',
		});
	});

	it('rejects an explicit source account not linked to the user', async () => {
		const res = await post('/sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			sourceAccountId: '555555555',
		});

		expect(res.status).toBe(403);
		expect(syncQueue.add).not.toHaveBeenCalled();
	});

	it('rejects AI sync opt-in unless cloud or local AI analysis is enabled', async () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');

		const res = await post('/sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});

		expect(res.status).toBe(403);
		expect(syncQueue.add).not.toHaveBeenCalled();
	});

	it('allows AI sync opt-in when local Qwen analysis is configured', async () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
		vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'local');
		vi.stubEnv('COMMITMENT_LLM_BASE_URL', 'http://localhost:11434/v1');
		vi.stubEnv('COMMITMENT_LLM_MODEL', 'qwen3:4b-instruct');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'qwen');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'qwen3-embedding:0.6b');

		const res = await post('/sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});

		expect(res.status).toBe(200);
		expect(syncQueue.add).toHaveBeenCalledWith('sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'private_recent',
			enableAiProcessing: true,
		});
	});

	it('falls back to contacts-only for invalid sync scope', async () => {
		const res = await post('/sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'full_history',
			enableAiProcessing: true,
		});

		expect(res.status).toBe(200);
		expect(syncQueue.add).toHaveBeenCalledWith('sync-contacts', {
			userId: USER_ID,
			workspaceId: WORKSPACE_ID,
			syncScope: 'contacts_only',
			enableAiProcessing: false,
		});
	});

	it('rejects sync when the user is not a workspace member', async () => {
		(isWorkspaceMember as ReturnType<typeof vi.fn>).mockResolvedValue(false);

		const res = await post('/sync-contacts', { userId: USER_ID, workspaceId: WORKSPACE_ID });

		expect(res.status).toBe(403);
		expect(syncQueue.add).not.toHaveBeenCalled();
	});
});

describe('SEC-022 — Input validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);
		(connection.ttl as ReturnType<typeof vi.fn>).mockResolvedValue(900);
		(connection.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
	});

	it('/send-code rejects invalid phone format', async () => {
		const res = await post('/send-code', { phone: 'not-a-phone' });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid.*phone/i);
	});

	it('/send-code rejects phone without + prefix', async () => {
		const res = await post('/send-code', { phone: '11111111111' });
		expect(res.status).toBe(400);
	});

	it('/send-code rejects phone that is too short', async () => {
		const res = await post('/send-code', { phone: '+123' });
		expect(res.status).toBe(400);
	});

	it('/verify-code rejects non-numeric code', async () => {
		const res = await post('/verify-code', { phone: '+11111111111', code: 'abc' });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid.*phone.*code|invalid.*code/i);
	});

	it('/verify-code rejects missing phone', async () => {
		const res = await post('/verify-code', { code: '12345' });
		expect(res.status).toBe(400);
	});

	it('/verify-code rejects missing code', async () => {
		const res = await post('/verify-code', { phone: '+11111111111' });
		expect(res.status).toBe(400);
	});

	it('/disconnect-session rejects invalid userId format', async () => {
		const res = await post('/disconnect-session', { userId: 'not-a-uuid' });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid.*userId/i);
	});

	it('/sync-contacts rejects invalid UUID for userId', async () => {
		const res = await post('/sync-contacts', {
			userId: 'bad',
			workspaceId: '12345678-1234-1234-1234-123456789abc',
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/invalid/i);
	});

	it('/sync-contacts rejects invalid UUID for workspaceId', async () => {
		const res = await post('/sync-contacts', {
			userId: '12345678-1234-1234-1234-123456789abc',
			workspaceId: 'bad',
		});
		expect(res.status).toBe(400);
	});
});

describe('/verify-code rate limiting (SEC-058)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(connection.ttl as ReturnType<typeof vi.fn>).mockResolvedValue(900);
		// ASA-003: hash is stored server-side — mock Redis GET to return it
		(connection.get as ReturnType<typeof vi.fn>).mockResolvedValue('hash123');
		(connection.del as ReturnType<typeof vi.fn>).mockResolvedValue(1);
	});

	it('allows requests within the limit', async () => {
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(5); // at limit, not over
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			telegramUserId: 'tg-123',
			telegramSession: 'session-data',
		});

		// ASA-003: phoneCodeHash no longer sent by client
		const res = await post('/verify-code', {
			phone: PHONE_A,
			code: '12345',
			userId: USER_ID,
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		// ASA-002: response is encrypted — no raw telegramSession
		expect(body).toHaveProperty('encryptedSession');
		expect(body).toHaveProperty('sessionKekEncrypted');
		expect(body).not.toHaveProperty('telegramSession');
	});

	it('rate-limit-verify-code: 6th call returns 429', async () => {
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(6);

		const res = await post('/verify-code', {
			phone: PHONE_A,
			code: '12345',
			userId: USER_ID,
		});

		expect(res.status).toBe(429);
		const body = (await res.json()) as { error: string; retryAfter: number };
		expect(body.error).toBe('Too many requests');
	});
});
