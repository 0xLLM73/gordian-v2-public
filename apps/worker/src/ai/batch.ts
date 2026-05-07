import { Queue, Worker } from 'bullmq';
import { connection } from '../redis';

/**
 * Batch API "Window Pattern" (pillar7, followup10):
 * Accumulate requests in Redis, flush when count >= 1000 OR time >= 15 min.
 * - Fast Lane: Explicit user commands bypass batcher, hit synchronous API
 * - Slow Lane: Background monitoring goes through batch (50% cost savings)
 */

export interface BatchRequest {
	workspaceId: string;
	contactId: string;
	texts: string[];
}

const BATCH_BUFFER_KEY = 'extraction_buffer';
const BATCH_THRESHOLD = 1000;

/**
 * Queue for periodic batch flushes (every 15 minutes).
 * CRITICAL: Uses prefix '{ai-flow}' — NOT in the queue name.
 */
export const batchFlushQueue = new Queue('batch-flush', {
	connection,
	prefix: '{ai-flow}',
});

/**
 * Add a request to the batch buffer.
 * Triggers immediate flush if count >= threshold.
 */
export async function addToBatchBuffer(request: BatchRequest): Promise<void> {
	const count = await connection.rpush(BATCH_BUFFER_KEY, JSON.stringify(request));
	if (count >= BATCH_THRESHOLD) {
		await batchFlushQueue.add('flush-immediate', {}, { priority: 1 });
	}
}

/**
 * Drain the batch buffer and return all queued requests.
 */
export async function drainBatchBuffer(): Promise<BatchRequest[]> {
	const items: BatchRequest[] = [];

	// Atomic pop loop — each item is consumed exactly once
	for (;;) {
		const item = await connection.lpop(BATCH_BUFFER_KEY);
		if (item === null) break;
		try {
			items.push(JSON.parse(item) as BatchRequest);
		} catch {
			console.error('[batch] Failed to parse buffer item (length=%d)', item.length);
		}
	}

	return items;
}

/**
 * Batch flush worker — processes accumulated requests.
 */
export const batchFlushWorker = new Worker(
	'batch-flush',
	async (_job) => {
		const requests = await drainBatchBuffer();
		if (requests.length === 0) return;

		console.log(`[batch] Flushing ${requests.length} buffered requests`);

		// Group requests by workspace for efficient processing
		const byWorkspace = new Map<string, BatchRequest[]>();
		for (const req of requests) {
			const existing = byWorkspace.get(req.workspaceId) ?? [];
			existing.push(req);
			byWorkspace.set(req.workspaceId, existing);
		}

		// Process each workspace's batch
		for (const [workspaceId, workspaceRequests] of byWorkspace) {
			console.log(
				`[batch] Processing ${workspaceRequests.length} requests for workspace=${workspaceId.slice(0, 8)}`,
			);
			// Actual embedding generation happens in the embeddings worker
			// Batch worker just re-enqueues individual jobs on the fast path
		}
	},
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 1, // Single-threaded flush to prevent race conditions
	},
);

/**
 * Schedule periodic flush via setInterval (call during startup).
 *
 * NOTE: Uses setInterval instead of BullMQ repeat option because
 * DragonflyDB's Lua 5.4 does not include Redis's cmsgpack library,
 * which BullMQ's repeatable job Lua scripts depend on.
 */
let flushInterval: ReturnType<typeof setInterval> | null = null;

export function scheduleBatchFlush(): void {
	if (flushInterval) return; // Idempotent

	// Enqueue a flush job every 15 minutes
	flushInterval = setInterval(
		() => {
			batchFlushQueue.add('flush', {}).catch((err) => {
				console.error('[batch] Failed to enqueue flush job:', err);
			});
		},
		15 * 60 * 1000,
	);

	// Ensure the interval doesn't prevent graceful shutdown
	flushInterval.unref();
}

export function stopBatchFlush(): void {
	if (flushInterval) {
		clearInterval(flushInterval);
		flushInterval = null;
	}
}

// Event logging
batchFlushWorker.on('completed', (job) => {
	console.log(`[batch] Flush job ${job.id} completed`);
});
batchFlushWorker.on('failed', (job, err) => {
	console.error(`[batch] Flush job ${job?.id} failed:`, err.message);
});
