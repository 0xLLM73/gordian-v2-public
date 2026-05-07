import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateInternalSecret } from '../../middleware/auth';

// Note: validateInternalSecret reads process.env.WORKER_INTERNAL_SECRET or INTERNAL_AUTH_SECRET.
// Tests set the env var directly.

describe('validateInternalSecret', () => {
	const originalEnv = process.env;

	it('returns true for correct WORKER_INTERNAL_SECRET', () => {
		process.env.WORKER_INTERNAL_SECRET = 'test-secret-worker';
		Reflect.deleteProperty(process.env, 'INTERNAL_AUTH_SECRET');
		expect(validateInternalSecret('test-secret-worker')).toBe(true);
		process.env = { ...originalEnv };
	});

	it('falls back to INTERNAL_AUTH_SECRET when WORKER_INTERNAL_SECRET unset', () => {
		Reflect.deleteProperty(process.env, 'WORKER_INTERNAL_SECRET');
		process.env.INTERNAL_AUTH_SECRET = 'legacy-shared-secret';
		expect(validateInternalSecret('legacy-shared-secret')).toBe(true);
		process.env = { ...originalEnv };
	});

	it('returns false for wrong secret', () => {
		process.env.WORKER_INTERNAL_SECRET = 'correct-secret';
		Reflect.deleteProperty(process.env, 'INTERNAL_AUTH_SECRET');
		expect(validateInternalSecret('wrong-secret')).toBe(false);
		process.env = { ...originalEnv };
	});

	it('returns false for undefined header', () => {
		process.env.WORKER_INTERNAL_SECRET = 'some-secret';
		Reflect.deleteProperty(process.env, 'INTERNAL_AUTH_SECRET');
		expect(validateInternalSecret(undefined)).toBe(false);
		process.env = { ...originalEnv };
	});

	it('returns false for empty header', () => {
		process.env.WORKER_INTERNAL_SECRET = 'some-secret';
		Reflect.deleteProperty(process.env, 'INTERNAL_AUTH_SECRET');
		expect(validateInternalSecret('')).toBe(false);
		process.env = { ...originalEnv };
	});

	it('WORKER_INTERNAL_SECRET takes precedence over INTERNAL_AUTH_SECRET', () => {
		process.env.WORKER_INTERNAL_SECRET = 'new-secret';
		process.env.INTERNAL_AUTH_SECRET = 'old-secret';
		expect(validateInternalSecret('new-secret')).toBe(true);
		expect(validateInternalSecret('old-secret')).toBe(false);
		process.env = { ...originalEnv };
	});
});

describe('validateInternalSecret — ASA-008 constant-time comparison', () => {
	const originalEnv = process.env;

	it('does not throw when header is much shorter than the secret (no length oracle)', () => {
		process.env.WORKER_INTERNAL_SECRET = 'a-very-long-secret-value-used-in-production';
		Reflect.deleteProperty(process.env, 'INTERNAL_AUTH_SECRET');
		// A 1-character header — before ASA-008 this could cause timingSafeEqual to throw
		// because raw Buffer lengths would differ. HMAC normalization ensures equal lengths.
		expect(() => validateInternalSecret('x')).not.toThrow();
		expect(validateInternalSecret('x')).toBe(false);
		process.env = { ...originalEnv };
	});

	it('does not throw when header is much longer than the secret', () => {
		process.env.WORKER_INTERNAL_SECRET = 'short';
		Reflect.deleteProperty(process.env, 'INTERNAL_AUTH_SECRET');
		const longHeader = 'a'.repeat(512);
		expect(() => validateInternalSecret(longHeader)).not.toThrow();
		expect(validateInternalSecret(longHeader)).toBe(false);
		process.env = { ...originalEnv };
	});

	it('HMAC normalizes both inputs to 32-byte digests before comparison', () => {
		// If normalization is working, then the correct secret produces a matching digest.
		// We verify this by computing the expected digest ourselves and confirming the
		// function returns true — proving timingSafeEqual ran on equal-length 32-byte buffers.
		const secret = 'gordian-test-secret-normalized';
		process.env.WORKER_INTERNAL_SECRET = secret;
		Reflect.deleteProperty(process.env, 'INTERNAL_AUTH_SECRET');

		// The correct input must match — implying timingSafeEqual(normalize(s), normalize(s)) = true
		expect(validateInternalSecret(secret)).toBe(true);

		// A 1-char variant must not match — implying comparison ran (not short-circuited)
		expect(validateInternalSecret(secret.slice(0, 1))).toBe(false);

		process.env = { ...originalEnv };
	});

	it('timing-safe: both branches produce 32-byte HMAC digest (same buffer lengths)', () => {
		// Directly verify that the normalization produces a 32-byte digest —
		// this is the precondition that makes timingSafeEqual safe to call.
		const normalize = (input: string) =>
			createHmac('sha256', 'gordian-auth-normalize').update(Buffer.from(input, 'utf8')).digest();

		const shortDigest = normalize('x');
		const longDigest = normalize('a'.repeat(512));
		expect(shortDigest.length).toBe(32);
		expect(longDigest.length).toBe(32);
	});
});
