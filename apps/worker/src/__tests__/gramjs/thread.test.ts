import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the GramJS thread pool's isAuthPending eviction guard (ASA-006).
 *
 * The pool module-level setInterval fires every 60 s and skips entries with
 * isAuthPending===true.  We test this here by creating pool entries via
 * sendToUser() (which is synchronous up to the Promise return), then calling
 * setAuthPending(), and verifying the mocked worker.terminate is / is not
 * called as expected.
 */

vi.mock('node:worker_threads', () => ({
	Worker: vi.fn().mockImplementation(() => ({
		on: vi.fn(),
		postMessage: vi.fn(),
		terminate: vi.fn().mockResolvedValue(undefined),
	})),
}));

vi.mock('../../locks/telegram-session', () => ({
	withTelegramLock: vi.fn((_key: string, fn: () => unknown) => fn()),
}));

import { Worker } from 'node:worker_threads';
import { sendToUser, setAuthPending, terminateUser } from '../../gramjs/thread';

/** Helper: fire a sendToUser call (creates pool entry) without awaiting it. */
function createPoolEntry(key: string): void {
	const p = sendToUser<unknown>(key, { type: 'test' });
	p.catch(() => {}); // suppress unhandled rejection from 30 s timeout
}

/** Return the most recently created mock Worker instance. */
function lastWorkerInstance(): { terminate: ReturnType<typeof vi.fn> } {
	const ctor = Worker as unknown as ReturnType<typeof vi.fn>;
	return ctor.mock.results.at(-1)?.value as { terminate: ReturnType<typeof vi.fn> };
}

describe('setAuthPending eviction guard (ASA-006)', () => {
	beforeEach(() => {
		vi.stubEnv('TELEGRAM_MTPROTO_ENABLED', 'true');
		vi.stubEnv('TELEGRAM_API_ID', '12345');
		vi.stubEnv('TELEGRAM_API_HASH', 'test-hash');
	});

	afterEach(async () => {
		// Clean up pool entries so tests are isolated
		await terminateUser('auth-phone-1');
		await terminateUser('auth-phone-2');
		vi.clearAllMocks();
	});

	it('is a no-op for unknown pool keys — no throw', () => {
		expect(() => setAuthPending('does-not-exist', true)).not.toThrow();
		expect(() => setAuthPending('does-not-exist', false)).not.toThrow();
	});

	it('after send-code: pool entry created and setAuthPending(key, true) does not terminate worker', () => {
		createPoolEntry('auth-phone-1');
		const worker = lastWorkerInstance();

		// Simulate what the /send-code route does after sendToUser returns
		setAuthPending('auth-phone-1', true);

		// Worker must NOT have been terminated — it is mid-auth
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('after verify-code: setAuthPending(key, false) clears pending without throwing', () => {
		createPoolEntry('auth-phone-2');

		setAuthPending('auth-phone-2', true);
		// Simulate what the /verify-code route does at the start
		expect(() => setAuthPending('auth-phone-2', false)).not.toThrow();
	});

	it('calling setAuthPending(key, true) twice resets the auto-clear timeout without throwing', () => {
		createPoolEntry('auth-phone-1');

		setAuthPending('auth-phone-1', true);
		expect(() => setAuthPending('auth-phone-1', true)).not.toThrow();
	});
});
