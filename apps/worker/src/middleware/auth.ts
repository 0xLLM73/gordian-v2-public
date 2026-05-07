import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validate internal service-to-service auth (constant-time comparison).
 * Uses WORKER_INTERNAL_SECRET if set, falls back to INTERNAL_AUTH_SECRET.
 *
 * ASA-008: Both values are HMAC'd to a fixed 32-byte digest before comparison
 * so timing is constant regardless of input length (eliminates length oracle).
 */
export function validateInternalSecret(header: string | undefined): boolean {
	const secret = process.env.WORKER_INTERNAL_SECRET ?? process.env.INTERNAL_AUTH_SECRET;
	if (!secret) throw new Error('WORKER_INTERNAL_SECRET (or INTERNAL_AUTH_SECRET) is not set');
	if (!header) return false;

	const bufSecret = Buffer.from(secret, 'utf8');
	const bufHeader = Buffer.from(header, 'utf8');

	// Derive fixed 32-byte digests before comparison — prevents length oracle (ASA-008)
	const normalize = (buf: Buffer) =>
		createHmac('sha256', 'gordian-auth-normalize').update(buf).digest();

	return timingSafeEqual(normalize(bufSecret), normalize(bufHeader));
}
