import Redis from 'ioredis';

const redisUrl =
	process.env.DRAGONFLY_URL ?? (process.env.NODE_ENV === 'test' ? 'redis://localhost:6379' : null);
if (!redisUrl) {
	throw new Error('DRAGONFLY_URL is required. Start local Redis with pnpm demo:infra.');
}

/**
 * ioredis config for DragonflyDB on Fly.io (followup6):
 * - maxRetriesPerRequest: null — REQUIRED for BullMQ (blocking commands)
 * - enableReadyCheck: false — DragonflyDB compatibility
 * - family: 6 — Use IPv6 on Fly.io internal network
 */
export const connection = new Redis(redisUrl, {
	maxRetriesPerRequest: null, // MANDATORY for BullMQ (ERR-007)
	enableReadyCheck: false, // DragonflyDB compatibility
	family: process.env.FLY_APP_NAME ? 6 : 4, // IPv6 on Fly.io, IPv4 locally
	lazyConnect: process.env.NODE_ENV === 'test',
	retryStrategy: (times) => Math.min(times * 200, 5000),
	reconnectOnError: (err) => {
		const targetErrors = ['READONLY', 'ETIMEDOUT'];
		return targetErrors.some((e) => err.message.includes(e));
	},
});
