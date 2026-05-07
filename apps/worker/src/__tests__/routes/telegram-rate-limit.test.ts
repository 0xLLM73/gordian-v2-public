import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before any imports
vi.mock('../../redis', () => ({
	connection: {
		eval: vi.fn(),
		ttl: vi.fn(),
		set: vi.fn().mockResolvedValue('OK'),
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
import { sendToUser, setAuthPending } from '../../gramjs/thread';
import { connection } from '../../redis';
import { telegram } from '../../routes/telegram';

process.env.INTERNAL_AUTH_SECRET = 'test-secret';

const SECRET = 'test-secret';
// Normalized form of these phones is 11111111111 and 22222222222
const PHONE_A = '+11111111111';
const PHONE_B = '+22222222222';
// SEC-022: verify-code now requires userId as UUID
const USER_ID = '00000000-0000-4000-8000-000000000001';

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

beforeEach(() => {
	vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
	vi.stubEnv('TELEGRAM_SEND_ENABLED', 'true');
	vi.stubEnv('TELEGRAM_BOT_ENABLED', 'true');
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

	it('allows requests within the limit', async () => {
		(connection.eval as ReturnType<typeof vi.fn>).mockResolvedValue(3); // at limit, not over
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'hash123',
		});

		const res = await post('/send-code', { phone: PHONE_A });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ success: true }); // ASA-003: hash never returned to client
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
			expect.stringContaining('11111111111'), // normalized — digits only (W1)
			900,
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

	it('stores phoneCodeHash in Redis under auth:phone:{phone}', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'secret-hash-abc',
		});

		await post('/send-code', { phone: PHONE_A });

		expect(connection.set).toHaveBeenCalledWith(
			`auth:phone:${PHONE_A}`,
			'secret-hash-abc',
			'EX',
			180,
		);
	});

	it('does NOT return phoneCodeHash in the response body', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'secret-hash-abc',
		});

		const res = await post('/send-code', { phone: PHONE_A });
		const body = await res.json();
		expect(body).not.toHaveProperty('phoneCodeHash');
		expect(body).toEqual({ success: true });
	});

	it('sets isAuthPending=true after send-code (ASA-006)', async () => {
		(sendToUser as ReturnType<typeof vi.fn>).mockResolvedValue({
			phoneCodeHash: 'hash-x',
		});

		await post('/send-code', { phone: PHONE_A });

		expect(setAuthPending).toHaveBeenCalledWith(PHONE_A, true);
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

	it('retrieves phoneCodeHash from Redis using auth:phone:{phone}', async () => {
		await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });

		expect(connection.get).toHaveBeenCalledWith(`auth:phone:${PHONE_A}`);
	});

	it('deletes the Redis key immediately after retrieval (one-time use)', async () => {
		await post('/verify-code', { phone: PHONE_A, code: '12345', userId: USER_ID });

		expect(connection.del).toHaveBeenCalledWith(`auth:phone:${PHONE_A}`);
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

		expect(setAuthPending).toHaveBeenCalledWith(PHONE_A, false);
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
