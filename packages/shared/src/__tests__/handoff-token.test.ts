import * as jose from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHandoffToken, verifyHandoffToken } from '../handoff-token';

beforeAll(() => {
	process.env.INTERNAL_AUTH_SECRET = 'test-secret-32-chars-for-hs256-ok!';
});

describe('createHandoffToken', () => {
	it('creates a valid JWT string', async () => {
		const token = await createHandoffToken({
			userId: 'user-1',
			workspaceId: 'ws-1',
			action: 'sync-contacts',
		});
		expect(typeof token).toBe('string');
		expect(token.split('.')).toHaveLength(3);
	});
});

describe('verifyHandoffToken', () => {
	it('handoff-jti-no-redis: verifies token without redis (backwards compat)', async () => {
		const token = await createHandoffToken({
			userId: 'user-1',
			workspaceId: 'ws-1',
			action: 'sync-contacts',
		});
		const payload = await verifyHandoffToken(token);
		expect(payload.userId).toBe('user-1');
		expect(payload.workspaceId).toBe('ws-1');
		expect(payload.action).toBe('sync-contacts');
	});

	it('handoff-jti-single-use: second use of same token throws', async () => {
		const token = await createHandoffToken({
			userId: 'user-2',
			workspaceId: 'ws-2',
			action: 'sync-contacts',
		});

		const redis = {
			set: vi
				.fn()
				.mockResolvedValueOnce('OK') // first use — key did not exist
				.mockResolvedValueOnce(null), // second use — key already exists
		};

		await expect(verifyHandoffToken(token, redis)).resolves.toBeDefined();
		await expect(verifyHandoffToken(token, redis)).rejects.toThrow(
			'Handoff token already used (replay detected)',
		);
	});

	it('handoff-jti-different-tokens: different tokens both succeed', async () => {
		const t1 = await createHandoffToken({
			userId: 'u1',
			workspaceId: 'ws',
			action: 'sync-contacts',
		});
		const t2 = await createHandoffToken({
			userId: 'u2',
			workspaceId: 'ws',
			action: 'sync-contacts',
		});

		const redis = { set: vi.fn().mockResolvedValue('OK') };

		const p1 = await verifyHandoffToken(t1, redis);
		const p2 = await verifyHandoffToken(t2, redis);

		expect(p1.userId).toBe('u1');
		expect(p2.userId).toBe('u2');
		expect(redis.set).toHaveBeenCalledTimes(2);
	});

	it('handoff-jti-bypass-guard: token without jti + redis provided → throws (Fix 2)', async () => {
		// Craft a token without a jti claim to simulate an old/crafted token
		const secret = new TextEncoder().encode('test-secret-32-chars-for-hs256-ok!');
		const tokenNoJti = await new jose.SignJWT({
			userId: 'u',
			workspaceId: 'ws',
			action: 'sync-contacts',
		})
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('60s')
			.sign(secret);

		const redis = { set: vi.fn() };

		await expect(verifyHandoffToken(tokenNoJti, redis)).rejects.toThrow('missing jti');
		// Redis must not be called — the guard fires before the SET NX
		expect(redis.set).not.toHaveBeenCalled();
	});

	it('stores jti with 65s TTL and NX flag', async () => {
		const token = await createHandoffToken({
			userId: 'user-3',
			workspaceId: 'ws-3',
			action: 'sync-contacts',
		});

		const redis = { set: vi.fn().mockResolvedValue('OK') };
		await verifyHandoffToken(token, redis);

		expect(redis.set).toHaveBeenCalledWith(expect.stringMatching(/^jti:/), '1', 'EX', 65, 'NX');
	});
});
