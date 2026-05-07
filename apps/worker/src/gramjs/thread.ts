import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { withTelegramLock } from '../locks/telegram-session';
import { requireTelegramMtProtoConfig } from '../telegram-config';

/**
 * Per-user GramJS Worker Thread Pool (Stage 3 — SEC-010).
 *
 * Each userId gets its own dedicated worker thread + TelegramClient.
 * Eliminates cross-tenant session contamination from the old singleton pattern.
 *
 * Pool lifecycle:
 * - Threads spawn on first sendToUser() for that userId
 * - Idle threads (no calls for 5 min) are automatically terminated
 * - Pool capped at MAX_POOL_SIZE; oldest idle thread evicted if full
 * - terminateAll() called on graceful shutdown
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PoolEntry {
	worker: NodeWorker;
	userId: string;
	lastUsed: number;
	pendingCalls: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
	callIdCounter: number;
	/** ASA-006: true between send-code and verify-code — prevents mid-auth eviction */
	isAuthPending: boolean;
}

const pool = new Map<string, PoolEntry>();
const MAX_IDLE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_POOL_SIZE = 10;
const RPC_TIMEOUT_MS = 30_000;

const short = (id: string) => id.slice(0, 8);

function spawnEntry(userId: string): PoolEntry {
	const { apiId, apiHash } = requireTelegramMtProtoConfig();

	// Evict oldest idle entry if pool is full
	if (pool.size >= MAX_POOL_SIZE) {
		let oldestId: string | null = null;
		let oldestTime = Number.POSITIVE_INFINITY;
		for (const [uid, entry] of pool) {
			if (entry.pendingCalls.size === 0 && entry.lastUsed < oldestTime) {
				oldestTime = entry.lastUsed;
				oldestId = uid;
			}
		}
		if (oldestId) terminateUser(oldestId);
	}

	// Dev: use .mjs shim so tsx/esm loader is available in worker thread
	// Prod: esbuild bundles worker to dist/gramjs/gramjs-worker.js
	const isDev = import.meta.url.endsWith('.ts');
	const workerFile = isDev ? './gramjs-worker-shim.mjs' : './gramjs/gramjs-worker.js';

	const pendingCalls = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();

	const worker = new NodeWorker(path.resolve(__dirname, workerFile), {
		workerData: {
			apiId,
			apiHash,
			redisUrl: process.env.DRAGONFLY_URL,
		},
	});

	const entry: PoolEntry = {
		worker,
		userId,
		lastUsed: Date.now(),
		pendingCalls,
		callIdCounter: 0,
		isAuthPending: false,
	};

	pool.set(userId, entry);

	let lastFatalError: string | null = null;

	worker.on(
		'message',
		(msg: { type: string; id?: string; error?: string; [key: string]: unknown }) => {
			// Capture fatal errors before exit event fires
			if (msg.type === 'fatal-error') {
				lastFatalError = msg.error ?? 'Unknown fatal error';
				console.error(
					`[thread-pool] Fatal error from worker user=${short(userId)}: ${lastFatalError}`,
				);
				return;
			}

			if (msg.id) {
				const pendingCall = pendingCalls.get(msg.id);
				if (!pendingCall) return;
				const { resolve, reject } = pendingCall;
				pendingCalls.delete(msg.id);
				if (msg.type === 'error') {
					reject(new Error(msg.error ?? 'Unknown GramJS error'));
				} else {
					resolve(msg);
				}
			}
			// 'loaded' and 'connected' are informational — no pending call to resolve
		},
	);

	worker.on('error', (err) => {
		console.error(`[thread-pool] Worker error for user=${short(userId)}:`, err.message);
	});

	worker.on('exit', (code) => {
		const reason = lastFatalError ? ` (${lastFatalError})` : '';
		console.log(`[thread-pool] Worker for user=${short(userId)} exited (code ${code})${reason}`);
		pool.delete(userId);
		const exitError = lastFatalError ?? 'GramJS worker exited';
		for (const [, { reject }] of pendingCalls) {
			reject(new Error(exitError));
		}
		pendingCalls.clear();
	});

	return entry;
}

function getOrCreate(userId: string): PoolEntry {
	return pool.get(userId) ?? spawnEntry(userId);
}

/**
 * Send an RPC message to the dedicated worker thread for userId.
 * Spawns a new thread if one doesn't exist yet.
 */
export function sendToUser<T = unknown>(
	userId: string,
	message: Record<string, unknown>,
): Promise<T> {
	const entry = getOrCreate(userId);
	entry.lastUsed = Date.now();
	const id = `rpc_${++entry.callIdCounter}`;

	return new Promise<T>((resolve, reject) => {
		entry.pendingCalls.set(id, {
			resolve: resolve as (value: unknown) => void,
			reject,
		});
		entry.worker.postMessage({ ...message, id });

		setTimeout(() => {
			if (entry.pendingCalls.has(id)) {
				entry.pendingCalls.delete(id);
				reject(new Error(`GramJS RPC timeout: ${message.type}`));
			}
		}, RPC_TIMEOUT_MS);
	});
}

/**
 * Acquire per-user Redlock and connect the user's GramJS worker thread.
 * Disconnect-before-reconnect is handled inside gramjs-worker.ts initClient().
 */
export async function connectUser(userId: string, sessionString: string): Promise<void> {
	await withTelegramLock(userId, async () => {
		await sendToUser(userId, { type: 'connect', sessionString });
	});
}

/**
 * Terminate the worker thread for a specific user.
 * Called by the /disconnect-session endpoint.
 */
export async function terminateUser(userId: string): Promise<void> {
	const entry = pool.get(userId);
	if (!entry) return;
	pool.delete(userId);
	try {
		await entry.worker.terminate();
	} catch {
		// Already exited — ignore
	}
}

/**
 * Terminate all worker threads in the pool.
 * Called during graceful shutdown.
 */
export async function terminateAll(): Promise<void> {
	const ids = [...pool.keys()];
	await Promise.allSettled(ids.map((id) => terminateUser(id)));
	console.log(`[thread-pool] Terminated ${ids.length} worker(s)`);
}

/** Idle cleanup: terminate threads idle longer than MAX_IDLE_MS */
setInterval(() => {
	const now = Date.now();
	for (const [userId, entry] of pool) {
		if (entry.isAuthPending) continue; // ASA-006: never evict mid-auth
		if (entry.pendingCalls.size === 0 && now - entry.lastUsed > MAX_IDLE_MS) {
			console.log(`[thread-pool] Evicting idle worker for user=${short(userId)}`);
			terminateUser(userId);
		}
	}
}, 60_000).unref(); // unref() so interval doesn't prevent process exit

/** Timeout handles for ASA-006 auth-pending auto-clear (keyed by pool key) */
const authTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * ASA-006: Mark a pool entry as auth-pending (between send-code and verify-code).
 * Pending entries are skipped by the idle eviction loop.
 * Setting pending=true also starts a 3-minute safety timeout that auto-clears the flag
 * in case verify-code never arrives (e.g. user abandons the flow).
 */
export function setAuthPending(poolKey: string, pending: boolean): void {
	// Always clear any existing timeout first
	const existing = authTimeouts.get(poolKey);
	if (existing) {
		clearTimeout(existing);
		authTimeouts.delete(poolKey);
	}

	const entry = pool.get(poolKey);
	if (!entry) return;

	entry.isAuthPending = pending;

	if (pending) {
		const handle = setTimeout(
			() => {
				const e = pool.get(poolKey);
				if (e) e.isAuthPending = false;
				authTimeouts.delete(poolKey);
			},
			3 * 60 * 1000,
		);
		authTimeouts.set(poolKey, handle);
	}
}

/**
 * No-op: pool initializes threads on demand.
 * Kept so index.ts startup sequence doesn't need changing.
 */
export async function initGramJS(): Promise<void> {
	console.log('[thread-pool] Per-user GramJS thread pool ready (threads spawn on demand).');
}
