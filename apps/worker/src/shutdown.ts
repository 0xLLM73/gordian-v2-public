import { batchFlushWorker, stopBatchFlush } from './ai/batch';
import { briefWorker } from './ai/morning-brief';
import { terminateAll } from './gramjs/thread';
import {
	aiFlowProducer,
	embeddingsWorker,
	extractionWorker,
	orchestratorWorker,
	summaryWorker,
} from './queues/ai-flow';
import { backfillWorker, embeddingBackfillWorker } from './queues/backfill';
import { stopCalendarSync } from './queues/calendar-sync';
import { digestWorker } from './queues/digest';
import { stopFollowUpPlanProcessor } from './queues/follow-up-plan-processor';
import { fulfillmentWorker } from './queues/fulfillment';
import { healthScoringWorker, stopHealthScoring } from './queues/health-scoring';
import { flushAllBuffers } from './queues/message-buffer';
import { relationshipExtractionWorker } from './queues/relationship-extraction';
import { rotationWorker } from './queues/rotation';
import { syncWorker } from './queues/sync';
import { telegramHistoryImportWorker } from './queues/telegram-history-import';
import { stopTokenPriceUpdates } from './queues/token-price';
import { connection } from './redis';

/**
 * Graceful shutdown state machine (Stage 3 — updated for per-user thread pool):
 *
 * Phase 1: Stop Ingress — stop accepting new webhooks/jobs
 * Phase 2: Drain Queues — wait for in-flight jobs to complete
 * Phase 3: Close Connections — terminate all GramJS worker threads, close Redis
 *
 * Per-user Redlock locks use redlock.using() and auto-release when their fn exits.
 * No explicit lock release needed — threads terminating is sufficient.
 *
 * fly.toml kill_timeout=300 gives us 5 minutes for this process.
 */
export function gracefulShutdown(bot?: { stop: () => void }): void {
	let isShuttingDown = false;

	const shutdown = async (signal: string) => {
		if (isShuttingDown) return;
		isShuttingDown = true;
		console.log(`[shutdown] ${signal} received. Starting graceful shutdown...`);

		// Phase 1: Stop ingress
		try {
			bot?.stop();
			stopBatchFlush();
			stopTokenPriceUpdates();
			stopFollowUpPlanProcessor();
			stopCalendarSync();
			stopHealthScoring();
			const { stopKnowledgeCron } = await import('./queues/knowledge-cron');
			stopKnowledgeCron();
			console.log('[shutdown] Phase 1: Bot and scheduled processors stopped.');
		} catch (err) {
			console.error('[shutdown] Phase 1 error:', (err as Error).message);
		}

		// Phase 1.5: Flush message buffers → creates final BullMQ jobs
		try {
			await flushAllBuffers();
			console.log('[shutdown] Phase 1.5: Message buffers flushed.');
		} catch (err) {
			console.error('[shutdown] Phase 1.5 error:', (err as Error).message);
		}

		// Phase 2: Drain queues (wait up to 30s per worker)
		try {
			const { rationaleExtractionWorker } = await import('./queues/rationale-extraction');
			const { decisionRecordingWorker } = await import('./queues/decision-recording');
			const { knowledgeAnalysisWorker } = await import('./queues/knowledge-cron');
			const { styleAnalysisWorker } = await import('./queues/style-analysis');
			const { styleAggregationWorker, stopStyleAggregation } = await import(
				'./queues/style-aggregation'
			);
			stopStyleAggregation();
			await Promise.allSettled([
				syncWorker.close(),
				telegramHistoryImportWorker.close(),
				backfillWorker.close(),
				embeddingBackfillWorker.close(),
				orchestratorWorker.close(),
				extractionWorker.close(),
				embeddingsWorker.close(),
				summaryWorker.close(),
				fulfillmentWorker.close(),
				digestWorker.close(),
				relationshipExtractionWorker.close(),
				healthScoringWorker.close(),
				knowledgeAnalysisWorker.close(),
				batchFlushWorker.close(),
				briefWorker.close(),
				rotationWorker.close(),
				rationaleExtractionWorker.close(),
				decisionRecordingWorker.close(),
				styleAnalysisWorker.close(),
				styleAggregationWorker.close(),
				aiFlowProducer.close(),
			]);
			console.log('[shutdown] Phase 2: Queue workers drained.');
		} catch (err) {
			console.error('[shutdown] Phase 2 error:', (err as Error).message);
		}

		// Phase 3: Close connections
		try {
			await terminateAll();
			console.log('[shutdown] Phase 3: GramJS thread pool terminated.');
		} catch (err) {
			console.error('[shutdown] Phase 3 GramJS error:', (err as Error).message);
		}

		try {
			await connection.quit();
			console.log('[shutdown] Phase 3: Redis connection closed.');
		} catch (err) {
			console.error('[shutdown] Phase 3 Redis error:', (err as Error).message);
		}

		console.log('[shutdown] Graceful shutdown complete.');
		process.exit(0);
	};

	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}
