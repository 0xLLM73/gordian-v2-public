import Redlock from 'redlock';
import { connection } from '../redis';

/**
 * Per-user Redlock for Telegram session exclusivity (Stage 3 — SEC-010/SEC-015).
 *
 * CRITICAL: AUTH_KEY_DUPLICATED error permanently invalidates the Telegram session
 * if two processes connect simultaneously with the same auth_key (ERR-002).
 * There is NO recovery — the user must re-authenticate.
 *
 * Per-user lock keys (telegram:session:lock:{userId}) ensure:
 * - Concurrent sync jobs for different users don't interfere
 * - Rolling deploys can't cause cross-user session contamination
 * - Only one connect() is in-flight per user at any time
 *
 * fly.toml kill_timeout=300 gives old instance 5 min to drain before termination.
 */
const redlock = new Redlock([connection], {
	retryCount: 10,
	retryDelay: 500,
	retryJitter: 200,
	automaticExtensionThreshold: 500,
});

redlock.on('error', (err) => {
	console.error('[redlock] Error:', err.message);
});

/** Lock TTL: 60 seconds, auto-extended by Redlock while fn is running */
const LOCK_TTL = 60_000;

function lockKey(userId: string): string {
	return `telegram:session:lock:${userId}`;
}

/**
 * Execute fn while holding the per-user Telegram session lock.
 * Lock is automatically extended and released when fn completes or throws.
 */
export async function withTelegramLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
	return redlock.using([lockKey(userId)], LOCK_TTL, async (_signal) => {
		return fn();
	});
}
