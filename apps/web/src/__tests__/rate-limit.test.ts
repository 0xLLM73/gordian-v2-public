import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting, checkRateLimit } from '../lib/rate-limit';

describe('checkRateLimit', () => {
	afterEach(() => {
		_resetForTesting();
	});

	it('allows requests within the limit', () => {
		for (let i = 0; i < 10; i++) {
			const result = checkRateLimit('user-1', 10, 1_000);
			expect(result.allowed).toBe(true);
			expect(result.retryAfterMs).toBe(0);
		}
	});

	it('rejects requests at the limit', () => {
		for (let i = 0; i < 10; i++) {
			checkRateLimit('user-1', 10, 1_000);
		}
		const result = checkRateLimit('user-1', 10, 1_000);
		expect(result.allowed).toBe(false);
		expect(result.retryAfterMs).toBeGreaterThan(0);
	});

	it('isolates rate limits per key', () => {
		for (let i = 0; i < 10; i++) {
			checkRateLimit('user-1', 10, 1_000);
		}
		// user-1 is exhausted
		expect(checkRateLimit('user-1', 10, 1_000).allowed).toBe(false);
		// user-2 should still be allowed
		expect(checkRateLimit('user-2', 10, 1_000).allowed).toBe(true);
	});

	it('allows requests after the window expires', () => {
		vi.useFakeTimers();
		try {
			for (let i = 0; i < 10; i++) {
				checkRateLimit('user-1', 10, 1_000);
			}
			expect(checkRateLimit('user-1', 10, 1_000).allowed).toBe(false);

			// Advance past the window
			vi.advanceTimersByTime(1_001);

			expect(checkRateLimit('user-1', 10, 1_000).allowed).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('returns correct retryAfterMs', () => {
		vi.useFakeTimers();
		try {
			for (let i = 0; i < 5; i++) {
				checkRateLimit('user-1', 5, 2_000);
			}
			const result = checkRateLimit('user-1', 5, 2_000);
			expect(result.allowed).toBe(false);
			// retryAfterMs should be close to 2000ms (full window since all requests were at the same instant)
			expect(result.retryAfterMs).toBeLessThanOrEqual(2_000);
			expect(result.retryAfterMs).toBeGreaterThan(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('supports different limits per key (per-action overrides)', () => {
		// Simulate AI chat action: 3/min
		for (let i = 0; i < 3; i++) {
			expect(checkRateLimit('user-1:ai-chat', 3, 60_000).allowed).toBe(true);
		}
		expect(checkRateLimit('user-1:ai-chat', 3, 60_000).allowed).toBe(false);

		// Default action for same user still works
		expect(checkRateLimit('user-1', 10, 1_000).allowed).toBe(true);
	});
});
