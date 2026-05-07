if (process.env.NODE_ENV !== 'production') {
	const path = await import('node:path');
	const { config } = await import('dotenv');
	config({ path: path.resolve(import.meta.dirname, '../../../.env.local') });
}

// SEC-KMS-001: Fail fast if DEV_KMS_BYPASS is set in production
if (
	process.env.DEV_KMS_BYPASS === 'true' &&
	(process.env.NODE_ENV === 'production' || process.env.FLY_APP_NAME)
) {
	console.error('FATAL: DEV_KMS_BYPASS=true is forbidden in production');
	process.exit(1);
}

// SEC-PROV-250: Fail fast if WORKER_INTERNAL_SECRET is missing in production
// Without it, /rationale/extract (and other internal routes) accept any request.
if (
	!process.env.WORKER_INTERNAL_SECRET &&
	!process.env.INTERNAL_AUTH_SECRET &&
	(process.env.NODE_ENV === 'production' || process.env.FLY_APP_NAME)
) {
	throw new Error('WORKER_INTERNAL_SECRET must be set (required for internal route auth)');
}

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { scheduleBatchFlush } from './ai/batch';
import { briefQueue } from './ai/morning-brief';
import { initBot } from './bot';
import { initGramJS } from './gramjs/thread';
import { validateInternalSecret } from './middleware/auth';
import {
	embeddingsWorker,
	extractionWorker,
	goalExtractionWorker,
	orchestratorWorker,
	summaryWorker,
} from './queues/ai-flow';
import { backfillQueue, embeddingBackfillWorker } from './queues/backfill';
import { scheduleCalendarSync } from './queues/calendar-sync';
import { digestQueue, digestWorker } from './queues/digest';
import { scheduleFollowUpPlanProcessor } from './queues/follow-up-plan-processor';
import { fulfillmentWorker } from './queues/fulfillment';
import { goalDecompositionWorker } from './queues/goal-decomposition';
import {
	healthScoringQueue,
	healthScoringWorker,
	scheduleHealthScoring,
} from './queues/health-scoring';
import { investorPatternsWorker } from './queues/investor-patterns';
import { knowledgeExtractionWorker } from './queues/knowledge-extraction';
import { knowledgeInferenceWorker } from './queues/knowledge-inference';
import { getBufferStats } from './queues/message-buffer';
import {
	outcomeEvaluationWorker,
	scheduleOutcomeEvaluationSweep,
} from './queues/outcome-evaluation';
import { recommendationsWorker } from './queues/recommendations';
import {
	relationshipExtractionQueue,
	relationshipExtractionWorker,
} from './queues/relationship-extraction';
import { rotationQueue } from './queues/rotation';
import { syncQueue } from './queues/sync';
import { scheduleTokenPriceUpdates } from './queues/token-price';
import { connection } from './redis';
import { admin } from './routes/admin';
import { briefRoutes } from './routes/brief';
import { chatRoutes } from './routes/chat';
import { digest } from './routes/digest';
import { draftRoutes } from './routes/drafts';
import { feedback } from './routes/feedback';
import { telegram } from './routes/telegram';
import { gracefulShutdown } from './shutdown';
import { isTelegramBotEnabled, isTelegramMtProtoEnabled } from './telegram-config';

const app = new Hono();

// SEC-CORS: Restrict worker endpoints to trusted origins only.
// CORS_ORIGIN env var for production; localhost:3000 for local dev.
const allowedOrigins = process.env.CORS_ORIGIN
	? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
	: ['http://localhost:3000'];

app.use(
	'*',
	cors({
		origin: allowedOrigins,
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization', 'X-Internal-Secret'],
		maxAge: 86400,
	}),
);

/**
 * Health check for Fly.io (Phase 7, Step 7.3).
 * Verifies DragonflyDB connectivity and Postgres connection pool.
 */
app.get('/health', async (c) => {
	// SEC: Minimal response — Fly.io only needs the status code.
	// No infrastructure details, queue names, or uptime exposed.
	let healthy = true;

	try {
		const pong = await connection.ping();
		if (pong !== 'PONG') healthy = false;
	} catch {
		healthy = false;
	}

	try {
		const { db, sql } = await import('@repo/db');
		const result = (await db.execute(sql`SELECT 1 AS ok`)) as unknown as Array<{ ok: number }>;
		if (result.length === 0) healthy = false;
	} catch {
		healthy = false;
	}

	return c.json({ status: healthy ? 'ok' : 'error' }, healthy ? 200 : 503);
});

/**
 * Metrics endpoint (Phase 7, Step 7.3).
 * Returns queue depths, active worker counts, and memory usage.
 * SEC-029: requires X-Internal-Secret header (unlike /health which stays open for Fly.io).
 */
app.get('/metrics', async (c) => {
	const internalSecret = c.req.header('X-Internal-Secret');
	if (!validateInternalSecret(internalSecret)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	// Gather queue depths in parallel (including relationship-extraction and health-scoring)
	const [
		syncCounts,
		backfillCounts,
		briefCounts,
		rotationCounts,
		digestCounts,
		healthScoringCounts,
		relationshipExtractionCounts,
		redisInfo,
	] = await Promise.allSettled([
		syncQueue.getJobCounts('active', 'waiting', 'delayed', 'failed'),
		backfillQueue.getJobCounts('active', 'waiting', 'delayed', 'failed'),
		briefQueue.getJobCounts('active', 'waiting', 'delayed', 'failed'),
		rotationQueue.getJobCounts('active', 'waiting', 'delayed', 'failed'),
		digestQueue.getJobCounts('active', 'waiting', 'delayed', 'failed'),
		healthScoringQueue.getJobCounts('active', 'waiting', 'delayed', 'failed'),
		relationshipExtractionQueue.getJobCounts('active', 'waiting', 'delayed', 'failed'),
		connection.info('memory'),
	]);

	// Parse Redis memory info
	const redisMemory: Record<string, string> = {};
	if (redisInfo.status === 'fulfilled') {
		for (const line of redisInfo.value.split('\r\n')) {
			const [key, value] = line.split(':');
			if (key && value) {
				redisMemory[key] = value;
			}
		}
	}

	const mem = process.memoryUsage();

	return c.json({
		queues: {
			sync: syncCounts.status === 'fulfilled' ? syncCounts.value : null,
			backfill: backfillCounts.status === 'fulfilled' ? backfillCounts.value : null,
			briefs: briefCounts.status === 'fulfilled' ? briefCounts.value : null,
			rotation: rotationCounts.status === 'fulfilled' ? rotationCounts.value : null,
			digests: digestCounts.status === 'fulfilled' ? digestCounts.value : null,
			healthScoring: healthScoringCounts.status === 'fulfilled' ? healthScoringCounts.value : null,
			relationshipExtraction:
				relationshipExtractionCounts.status === 'fulfilled'
					? relationshipExtractionCounts.value
					: null,
		},
		memory: {
			node: {
				rss: Math.round(mem.rss / 1024 / 1024),
				heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
				heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
				external: Math.round(mem.external / 1024 / 1024),
			},
			redis: {
				usedMemory: redisMemory.used_memory_human ?? 'unknown',
				usedMemoryRss: redisMemory.used_memory_rss_human ?? 'unknown',
				evictedKeys: redisMemory.evicted_keys ?? '0',
			},
		},
		messageBuffer: getBufferStats(),
		uptime: process.uptime(),
	});
});

// Mount routes
app.route('/telegram', telegram);
app.route('/feedback', feedback);
app.route('/digest', digest);
app.route('/chat', chatRoutes);
app.route('/draft', draftRoutes);
app.route('/brief', briefRoutes);
app.route('/admin', admin);
// Gold-review and rationale routes mounted in main() to avoid top-level await

async function main() {
	console.log('Starting Gordian Worker...');

	// 0. Mount routes that use dynamic imports
	const { goldReview } = await import('./routes/gold-review');
	app.route('/gold-review', goldReview);
	const { default: rationaleRoutes } = await import('./routes/rationale');
	app.route('/', rationaleRoutes);
	const { default: decisionRoutes } = await import('./routes/decision');
	app.route('/', decisionRoutes);

	// 1. Initialize BullMQ queues (sync + backfill + AI pipeline + briefs workers start listening)
	// Queues are initialized on import via module-level declarations
	void relationshipExtractionWorker; // ensure worker listener is active
	void knowledgeExtractionWorker; // ensure worker listener is active
	void knowledgeInferenceWorker; // ensure worker listener is active
	void recommendationsWorker; // ensure worker listener is active
	void investorPatternsWorker; // ensure worker listener is active
	void outcomeEvaluationWorker; // Phase 35: outcome scoring worker
	void digestWorker; // ensure digest worker listener is active
	const { briefWorker } = await import('./ai/morning-brief');
	void briefWorker; // ensure brief worker listener is active
	void embeddingBackfillWorker; // Sprint 24: embedding backfill worker
	void orchestratorWorker; // core AI pipeline orchestrator
	void extractionWorker; // commitment extraction
	void embeddingsWorker; // memory creation (embeddings)
	void summaryWorker; // contact summaries
	void fulfillmentWorker; // commitment fulfillment tracking
	void goalExtractionWorker; // GI4: goal extraction from messages
	void goalDecompositionWorker; // GI2: goal decomposition AI
	const { rationaleExtractionWorker } = await import('./queues/rationale-extraction');
	void rationaleExtractionWorker; // DPG Phase 2: rationale extraction worker
	const { decisionRecordingWorker } = await import('./queues/decision-recording');
	void decisionRecordingWorker; // CGC: decision recording worker
	console.log(
		'BullMQ queues initialized (sync, backfill, ai-flow: orchestrator/extraction/embeddings/summaries/fulfillment/style-analysis/style-aggregation/decision-recording, briefs, rotation, digests, knowledge-extraction, relationship-extraction, health-scoring, outcome-evaluation, embedding-backfill, rationale-extraction).',
	);

	// 2. Schedule batch flush (every 15 minutes)
	scheduleBatchFlush();
	console.log('Batch flush scheduled.');

	// 2a. Schedule outcome evaluation sweep (Phase 35, every 2 hours)
	// Covers deal/goal/introduction terminal events that trigger from the web layer.
	if (process.env.FEATURE_OUTCOME_SCORING === 'true') {
		await scheduleOutcomeEvaluationSweep();
	}

	// 2b. Nightly health scoring — DragonflyDB-safe (no BullMQ repeat)
	void healthScoringWorker; // ensure worker listener is active
	scheduleHealthScoring();

	// 2b2. Bootstrap periodic sync (every 15 min) for all workspace members
	if (isTelegramMtProtoEnabled()) {
		const { schedulePeriodicSync } = await import('./queues/sync');
		schedulePeriodicSync();
	} else {
		console.log('Telegram MTProto integration disabled; periodic sync not scheduled.');
	}

	// 2c. Token price updates (every 2 hours)
	scheduleTokenPriceUpdates();

	// 2d. Follow-up plan step processor (every 1 hour)
	scheduleFollowUpPlanProcessor();

	// 2e. Calendar sync (every 4 hours)
	scheduleCalendarSync();

	// 2f. Hourly diff embedding backfill (enables DBSCAN clustering)
	const { diffEmbeddingWorker, scheduleDiffEmbedding } = await import('./queues/diff-embedding');
	void diffEmbeddingWorker;
	scheduleDiffEmbedding();

	// 2g. Nightly pattern aggregation (DBSCAN clustering of correction diffs)
	const { patternAggregationWorker, schedulePatternAggregation } = await import(
		'./queues/pattern-aggregation'
	);
	void patternAggregationWorker;
	schedulePatternAggregation();

	// 2g2. Style analysis + nightly aggregation (voice profiles)
	const { styleAnalysisWorker } = await import('./queues/style-analysis');
	void styleAnalysisWorker;
	const { styleAggregationWorker, scheduleStyleAggregation } = await import(
		'./queues/style-aggregation'
	);
	void styleAggregationWorker;
	scheduleStyleAggregation();

	// 2h. Nightly knowledge extraction cron (cost-optimized: embedding-first + Haiku)
	const { scheduleKnowledgeCron } = await import('./queues/knowledge-cron');
	scheduleKnowledgeCron();

	// 3. Initialize grammY bot and start long polling only when explicitly enabled.
	const bot = isTelegramBotEnabled() ? await initBot() : null;
	if (bot) {
		bot.start({
			onStart: () => console.log('grammY bot polling for updates.'),
		});
		console.log('grammY bot initialized.');
	} else {
		console.log('Telegram Bot API integration disabled; bot polling not started.');
	}

	// 4. Start HTTP server early so health checks pass during GramJS init
	serve({ fetch: app.fetch, port: 3001 }, () => {
		console.log('Gordian Worker running on port 3001');
	});

	// 5. Register graceful shutdown handler
	gracefulShutdown(bot ?? undefined);

	// 6. Start GramJS in Worker Thread (non-fatal — only needed for Telegram auth)
	// Connection happens on-demand when a user triggers send-code/verify-code,
	// with Redlock acquired first to prevent ERR-002.
	try {
		await initGramJS();
		console.log('GramJS Worker Thread started.');
	} catch (err) {
		console.error('GramJS Worker Thread failed to start (non-fatal):', (err as Error).message);
	}
}

main().catch((err) => {
	console.error('Worker failed to start:', err);
	process.exit(1);
});
