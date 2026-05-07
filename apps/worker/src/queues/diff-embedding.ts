import { maskEntities } from '@repo/crypto';
import { getUnembeddedDiffs, updateDiffEmbedding } from '@repo/db';
import { Worker } from 'bullmq';
import { generateEmbedding } from '../ai/embeddings';
import { prefilterEntities } from '../ai/prefilter';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

/**
 * Diff Embedding Backfill — hourly job that generates embeddings for correction diffs.
 *
 * Correction diffs are created with `mistakeEmbedding IS NULL`.
 * This job finds those diffs, generates an embedding from the description text,
 * and backfills the embedding — enabling DBSCAN clustering to discover patterns.
 *
 * SEC-003: Descriptions are sanitized at write time (no PII), but as a defense-in-depth
 * measure we also strip any residual entities before embedding (handles legacy diffs).
 */

const DIFF_EMBEDDING_INTERVAL = 60 * 60 * 1000; // 1 hour
const BATCH_SIZE = 50;
// Static salt for diff embedding masking (cross-workspace, no user PII expected)
// This is a defense-in-depth fallback — descriptions should already be PII-free
const DIFF_MASK_SALT = Buffer.from('diff-embedding-mask-salt-v1-gordian');

export const diffEmbeddingWorker = new Worker(
	'diff-embedding',
	withRLS(async () => {
		const diffs = await getUnembeddedDiffs(BATCH_SIZE);

		if (diffs.length === 0) {
			console.log('[diff-embedding] No unembedded diffs found');
			return { processed: 0 };
		}

		console.log(`[diff-embedding] Processing ${diffs.length} unembedded diffs`);

		let processed = 0;
		for (const diff of diffs) {
			if (!diff.description) continue;

			try {
				// SEC-003: Defense-in-depth — mask any residual PII before embedding
				const entities = prefilterEntities(diff.description);
				const safeText =
					entities.length > 0
						? maskEntities(diff.description, DIFF_MASK_SALT, entities).maskedText
						: diff.description;
				const embedding = await generateEmbedding(safeText);
				await updateDiffEmbedding(diff.id, embedding);
				processed++;
			} catch (err) {
				console.error(`[diff-embedding] Failed to embed diff ${diff.id}:`, (err as Error).message);
			}
		}

		console.log(`[diff-embedding] Embedded ${processed}/${diffs.length} diffs`);
		return { processed, total: diffs.length };
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 1 },
);

diffEmbeddingWorker.on('completed', (job) => {
	console.log(`[diff-embedding] Job ${job.id} completed`);
});
diffEmbeddingWorker.on('failed', (job, err) => {
	console.error(`[diff-embedding] Job ${job?.id} failed:`, err.message);
});

/**
 * Schedule hourly diff embedding backfill using setInterval (DragonflyDB-safe).
 * Uses the same pattern as health-scoring: no BullMQ repeatable jobs.
 */
let diffEmbeddingInterval: ReturnType<typeof setInterval> | null = null;

export async function scheduleDiffEmbedding() {
	if (diffEmbeddingInterval) return;

	// Run immediately on startup, then hourly
	const { Queue } = await import('bullmq');
	const queue = new Queue('diff-embedding', { connection, prefix: '{ai-flow}' });

	void queue.add('backfill', {}, { removeOnComplete: true, removeOnFail: { count: 100 } });

	diffEmbeddingInterval = setInterval(() => {
		void queue.add('backfill', {}, { removeOnComplete: true, removeOnFail: { count: 100 } });
	}, DIFF_EMBEDDING_INTERVAL);

	console.log('[diff-embedding] Hourly backfill scheduled');
}
