import { randomUUID } from 'node:crypto';
import * as jose from 'jose';

/**
 * Handoff Token: Short-lived JWT (60s TTL) for web->worker authenticated requests.
 * Signed with INTERNAL_AUTH_SECRET (shared between web and worker).
 *
 * Each token includes a unique JTI claim. When verifyHandoffToken is called with
 * a Redis connection, the JTI is stored in DragonflyDB (NX, TTL 65s) to prevent
 * replay attacks — a token can only be used once within its validity window.
 */

function getSecret(): Uint8Array {
	// SEC-018: use dedicated JWT secret; fall back to shared secret for backwards compat
	const secret = process.env.HANDOFF_JWT_SECRET ?? process.env.INTERNAL_AUTH_SECRET;
	if (!secret) throw new Error('HANDOFF_JWT_SECRET (or INTERNAL_AUTH_SECRET) is not set');
	return new TextEncoder().encode(secret);
}

/** Minimal interface for DragonflyDB/Redis JTI replay prevention. */
interface RedisNx {
	set(
		key: string,
		value: string,
		expiryMode: string,
		time: number,
		setMode: string,
	): Promise<string | null>;
}

export async function createHandoffToken(payload: {
	userId: string;
	workspaceId: string;
	action: string;
}): Promise<string> {
	return new jose.SignJWT(payload)
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setJti(randomUUID()) // Unique token ID — enables replay prevention
		.setExpirationTime('60s') // 60-second TTL
		.sign(getSecret());
}

export async function verifyHandoffToken(
	token: string,
	redis?: RedisNx,
): Promise<{ userId: string; workspaceId: string; action: string }> {
	const { payload } = await jose.jwtVerify(token, getSecret());

	// JTI replay prevention (SEC-024): when redis is provided, require jti and enforce
	// single-use. Tokens without jti are rejected — a missing jti claim would otherwise
	// silently bypass replay protection (e.g. crafted or legacy tokens).
	if (redis) {
		if (!payload.jti) {
			throw new Error('Handoff token missing jti — replay prevention requires jti');
		}
		// SET NX returns 'OK' if inserted (first use), null if key existed (replay).
		const result = await redis.set(`jti:${payload.jti}`, '1', 'EX', 65, 'NX');
		if (result === null) {
			throw new Error('Handoff token already used (replay detected)');
		}
	}

	return payload as { userId: string; workspaceId: string; action: string };
}
