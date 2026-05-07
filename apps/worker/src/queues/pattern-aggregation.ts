import {
	assignPatternToDiffs,
	createSemanticPattern,
	findSimilarSemanticPatterns,
	getAllDiffEmbeddings,
	reinforcePattern,
} from '@repo/db';
import { Queue, Worker } from 'bullmq';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

// density-clustering is pure JS with no TS types
// @ts-expect-error — no type declarations available
import DBSCAN from 'density-clustering/lib/DBSCAN';

// ─── Queue ───────────────────────────────────────────────────────────────────

export const patternAggregationQueue = new Queue('pattern-aggregation', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 30000 },
		removeOnComplete: { count: 50 },
		removeOnFail: { count: 100 },
	},
});

// ─── Cosine distance function ────────────────────────────────────────────────

function cosineDistance(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (denom === 0) return 1;
	return 1 - dot / denom;
}

/**
 * Compute centroid of a set of embeddings.
 */
function computeCentroid(embeddings: number[][]): number[] {
	const dim = embeddings[0].length;
	const centroid = new Array(dim).fill(0);
	for (const emb of embeddings) {
		for (let i = 0; i < dim; i++) {
			centroid[i] += emb[i];
		}
	}
	for (let i = 0; i < dim; i++) {
		centroid[i] /= embeddings.length;
	}
	return centroid;
}

/**
 * Synthesize a pattern rule from cluster members using Claude.
 */
async function synthesizePatternRule(centroidDescription: string): Promise<string> {
	try {
		const { inferWithCache } = await import('../ai/cached-inference');
		const response = await inferWithCache(
			'You are a pattern synthesis engine. Given a description of clustered error patterns, produce a single concise rule (1-2 sentences) that captures the common pattern.',
			'',
			'',
			[
				{
					role: 'user' as const,
					content: `Synthesize a single concise correction rule from these clustered error descriptions:\n\n${centroidDescription}`,
				},
			],
			{
				maxTokens: 256,
				helicone: { feature: 'pattern-synthesis' },
			},
		);
		const textBlock = response.content.find((b) => b.type === 'text');
		return textBlock?.type === 'text' ? textBlock.text : 'Unclassified error pattern';
	} catch (err) {
		console.error('[pattern-aggregation] Failed to synthesize rule:', (err as Error).message);
		return 'Unclassified error pattern';
	}
}

// ─── Worker ──────────────────────────────────────────────────────────────────

export const patternAggregationWorker = new Worker(
	'pattern-aggregation',
	withRLS(async () => {
		console.log('[pattern-aggregation] Starting nightly clustering...');

		// 1. Fetch all unclustered diff embeddings (max 5000)
		const diffs = await getAllDiffEmbeddings(5000);
		if (diffs.length < 3) {
			console.log(
				`[pattern-aggregation] Only ${diffs.length} unclustered diffs — skipping (need >= 3)`,
			);
			return;
		}

		const embeddings = diffs.map((d: { id: string; embedding: number[] }) => d.embedding);

		// 2. Run DBSCAN with cosine distance (epsilon=0.3, minPts=3)
		const dbscan = new DBSCAN();
		const clusters: number[][] = dbscan.run(embeddings, 0.3, 3, cosineDistance);

		console.log(
			`[pattern-aggregation] DBSCAN found ${clusters.length} clusters from ${diffs.length} diffs`,
		);

		let newPatterns = 0;
		let reinforced = 0;

		// 3. Process each cluster
		for (const cluster of clusters) {
			if (cluster.length < 3) continue;

			const clusterEmbeddings = cluster.map((idx) => embeddings[idx]);
			const clusterIds = cluster.map((idx) => diffs[idx].id);
			const centroid = computeCentroid(clusterEmbeddings);

			// Check for existing similar pattern (> 0.85 similarity)
			const similar = await findSimilarSemanticPatterns(centroid, 'commitment_extraction', 1);
			const topMatch = similar[0];

			if (topMatch && topMatch.similarity > 0.85) {
				// Reinforce existing pattern
				await reinforcePattern(topMatch.id);
				await assignPatternToDiffs(clusterIds, topMatch.id);
				reinforced++;
			} else {
				// Synthesize new pattern rule
				const descriptions = cluster
					.slice(0, 10)
					.map((idx) => `- Diff ${diffs[idx].id}`)
					.join('\n');
				const patternText = await synthesizePatternRule(descriptions);

				const pattern = await createSemanticPattern({
					featureDomain: 'commitment_extraction',
					patternText,
					embedding: centroid,
					confidenceScore: 0.5,
				});

				if (pattern) {
					await assignPatternToDiffs(clusterIds, pattern.id);
					newPatterns++;
				}
			}
		}

		console.log(
			`[pattern-aggregation] Done: ${newPatterns} new patterns, ${reinforced} reinforced`,
		);
	}),
	{
		connection,
		prefix: '{ai-flow}',
		concurrency: 1,
	},
);

patternAggregationWorker.on('completed', (job) => {
	console.log(`[pattern-aggregation] Job ${job.id} completed`);
});

patternAggregationWorker.on('failed', (job, err) => {
	console.error(`[pattern-aggregation] Job ${job?.id} failed:`, err.message);
});

// ─── Scheduled interval (nightly) ────────────────────────────────────────────

let aggregationInterval: ReturnType<typeof setInterval> | null = null;

export function schedulePatternAggregation(): void {
	// Queue initial run
	patternAggregationQueue
		.add('nightly-cluster', {})
		.catch((err) =>
			console.error('[pattern-aggregation] Failed to queue initial run:', (err as Error).message),
		);

	// Schedule nightly (every 24 hours)
	aggregationInterval = setInterval(
		async () => {
			try {
				await patternAggregationQueue.add('nightly-cluster', {});
			} catch (err) {
				console.error('[pattern-aggregation] Failed to queue nightly run:', (err as Error).message);
			}
		},
		24 * 60 * 60 * 1000,
	);
}

export function stopPatternAggregation(): void {
	if (aggregationInterval) {
		clearInterval(aggregationInterval);
		aggregationInterval = null;
	}
}
