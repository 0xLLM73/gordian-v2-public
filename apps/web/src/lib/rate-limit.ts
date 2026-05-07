// Sliding window rate limiter — in-memory, no Redis
const windows = new Map<string, number[]>();

export interface RateLimitResult {
	allowed: boolean;
	retryAfterMs: number;
}

/**
 * Check if a request is allowed under the sliding window rate limit.
 * @param key - Unique key (e.g. userId or userId:actionName)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 */
export function checkRateLimit(
	key: string,
	maxRequests: number,
	windowMs: number,
): RateLimitResult {
	const now = Date.now();
	const timestamps = windows.get(key) ?? [];
	const valid = timestamps.filter((t) => now - t < windowMs);

	if (valid.length >= maxRequests) {
		const oldest = valid[0] ?? now;
		return { allowed: false, retryAfterMs: windowMs - (now - oldest) };
	}

	valid.push(now);
	windows.set(key, valid);
	return { allowed: true, retryAfterMs: 0 };
}

/** Exposed for testing — clears all rate limit state. */
export function _resetForTesting(): void {
	windows.clear();
}

// Cleanup stale entries every 60s
if (typeof setInterval !== 'undefined') {
	setInterval(() => {
		const now = Date.now();
		for (const [key, timestamps] of windows) {
			const valid = timestamps.filter((t) => now - t < 60_000);
			if (valid.length === 0) windows.delete(key);
			else windows.set(key, valid);
		}
	}, 60_000).unref?.();
}
