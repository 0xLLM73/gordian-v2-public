import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reset module between tests so the Map is fresh
let checkRateLimit: typeof import('@/lib/rate-limit').checkRateLimit;

beforeEach(async () => {
	vi.resetModules();
	const mod = await import('@/lib/rate-limit');
	checkRateLimit = mod.checkRateLimit;
});

describe('checkRateLimit', () => {
	it('allows requests within limit', () => {
		const result1 = checkRateLimit('user1:test', 3, 60_000);
		const result2 = checkRateLimit('user1:test', 3, 60_000);
		const result3 = checkRateLimit('user1:test', 3, 60_000);

		expect(result1.allowed).toBe(true);
		expect(result2.allowed).toBe(true);
		expect(result3.allowed).toBe(true);
	});

	it('rejects at limit', () => {
		checkRateLimit('user2:test', 2, 60_000);
		checkRateLimit('user2:test', 2, 60_000);
		const result = checkRateLimit('user2:test', 2, 60_000);

		expect(result.allowed).toBe(false);
		expect(result.retryAfterMs).toBeGreaterThan(0);
		expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
	});

	it('isolates per key', () => {
		checkRateLimit('userA:endpoint1', 1, 60_000);
		const result = checkRateLimit('userA:endpoint2', 1, 60_000);

		expect(result.allowed).toBe(true);
	});

	it('allows requests after window expires', () => {
		vi.useFakeTimers();

		checkRateLimit('user3:test', 1, 1000);
		const blocked = checkRateLimit('user3:test', 1, 1000);
		expect(blocked.allowed).toBe(false);

		vi.advanceTimersByTime(1001);

		const unblocked = checkRateLimit('user3:test', 1, 1000);
		expect(unblocked.allowed).toBe(true);

		vi.useRealTimers();
	});
});
