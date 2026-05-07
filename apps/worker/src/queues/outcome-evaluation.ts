/**
 * Phase 35 (Sprint 18) — Outcome Evaluation Queue
 *
 * BullMQ queue + worker for processing terminal event outcomes.
 *
 * Architecture:
 * • Commitment outcomes: event-driven — enqueued inline from fulfillment.ts
 *   after markCommitmentFulfilled() completes.
 * • Deal outcomes: scheduled sweep — the worker queries all recently closed
 *   deals (won/lost within the last 2 hours) on every run. This avoids
 *   coupling the DAL (which runs in the web layer) to BullMQ.
 * • Goal outcomes: scheduled sweep — queries recently completed goals.
 * • Introduction outcomes: scheduled sweep — queries recently completed intros.
 * • Relationship outcomes: event-driven — enqueued from health-scoring.ts
 *   after upsertHealthScore() for contacts with significant trend changes.
 *
 * The scheduled sweep runs every 2 hours. The lookback window of 2 hours
 * limits which entities are re-evaluated each run; terminal events rarely repeat.
 *
 * All queues use prefix '{ai-flow}' to share a Redis hashtag (ERR-008).
 */

import { and, db, deals, eq, goals, introductions, sql } from '@repo/db';
import { Queue, Worker } from 'bullmq';
import {
	evaluateCommitment,
	evaluateDeal,
	evaluateGoal,
	evaluateIntroduction,
	evaluateRelationship,
} from '../ai/outcome-evaluators';
import { withRLS } from '../middleware/rls';
import { connection } from '../redis';

// ─── Job data types ───────────────────────────────────────────────────────────

interface CommitmentEvalJobData {
	type: 'commitment';
	workspaceId: string;
	commitmentId: string;
	result: 'fulfilled' | 'missed';
}

interface RelationshipEvalJobData {
	type: 'relationship';
	workspaceId: string;
	contactId: string;
}

/** Sweep job processes all recently terminal deals/goals/introductions globally */
interface SweepJobData {
	type: 'sweep';
	/** Lookback window in minutes (default 120 = 2 hours) */
	windowMinutes?: number;
}

type OutcomeEvalJobData = CommitmentEvalJobData | RelationshipEvalJobData | SweepJobData;

// ─── Queue ────────────────────────────────────────────────────────────────────

export const outcomeEvaluationQueue = new Queue<OutcomeEvalJobData>('outcome-evaluation', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: 'exponential', delay: 10_000 },
		removeOnComplete: { count: 500 },
		removeOnFail: { count: 1000 },
	},
});

// ─── Enqueue helpers (called from other workers) ──────────────────────────────

/**
 * Enqueue a commitment outcome evaluation.
 * Called from fulfillment.ts after markCommitmentFulfilled().
 * jobId ensures idempotency at the queue layer (one job per commitment per result).
 */
export async function enqueueCommitmentEvaluation(
	workspaceId: string,
	commitmentId: string,
	result: 'fulfilled' | 'missed',
): Promise<void> {
	await outcomeEvaluationQueue.add(
		'commitment-eval',
		{ type: 'commitment', workspaceId, commitmentId, result } satisfies CommitmentEvalJobData,
		{ jobId: `commitment:${commitmentId}:${result}` },
	);
}

/**
 * Enqueue a relationship health evaluation.
 * Called from health-scoring.ts for contacts with significant trend changes.
 * jobId ensures at-most-once evaluation per contact per day.
 */
export async function enqueueRelationshipEvaluation(
	workspaceId: string,
	contactId: string,
): Promise<void> {
	const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	await outcomeEvaluationQueue.add(
		'relationship-eval',
		{ type: 'relationship', workspaceId, contactId } satisfies RelationshipEvalJobData,
		{ jobId: `relationship:${contactId}:${dateKey}` },
	);
}

/**
 * Schedule the global sweep job (deals + goals + introductions).
 * Called once at worker startup to register a repeatable job.
 */
export async function scheduleOutcomeEvaluationSweep(): Promise<void> {
	await outcomeEvaluationQueue.add(
		'sweep',
		{ type: 'sweep', windowMinutes: 120 } satisfies SweepJobData,
		{
			jobId: 'outcome-sweep',
			repeat: { every: 2 * 60 * 60 * 1000 }, // every 2 hours
		},
	);
	console.log('[outcome-evaluation] Sweep job scheduled (every 2h)');
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export const outcomeEvaluationWorker = new Worker<OutcomeEvalJobData>(
	'outcome-evaluation',
	withRLS(async (job) => {
		const data = job.data;

		if (data.type === 'commitment') {
			await evaluateCommitment(data.workspaceId, data.commitmentId, data.result);
			return { type: 'commitment', commitmentId: data.commitmentId };
		}

		if (data.type === 'relationship') {
			await evaluateRelationship(data.workspaceId, data.contactId);
			return { type: 'relationship', contactId: data.contactId };
		}

		if (data.type === 'sweep') {
			return runSweep(data.windowMinutes ?? 120);
		}
	}),
	{ connection, prefix: '{ai-flow}', concurrency: 3 },
);

// ─── Sweep implementation ─────────────────────────────────────────────────────

/**
 * Query and evaluate all recently terminal deals, goals, and introductions.
 *
 * Reads only non-PII, non-encrypted fields. No envelope required.
 * createOutcome() idempotency ensures re-running is safe.
 */
async function runSweep(windowMinutes: number): Promise<Record<string, number>> {
	const since = new Date(Date.now() - windowMinutes * 60 * 1000);
	const counts = { deals: 0, goals: 0, introductions: 0 };

	console.log(`[outcome-evaluation] Sweep starting (window=${windowMinutes}min)`);

	// ── Recently closed deals ──
	const recentDeals = await db
		.select({
			id: deals.id,
			workspaceId: deals.workspaceId,
			stage: deals.stage,
		})
		.from(deals)
		.where(
			and(
				sql`${deals.stage} IN ('won', 'lost')`,
				sql`${deals.closedAt} IS NOT NULL`,
				sql`${deals.closedAt} >= ${since.toISOString()}::timestamptz`,
			),
		)
		.limit(500);

	for (const deal of recentDeals) {
		try {
			await evaluateDeal(deal.workspaceId, deal.id);
			counts.deals++;
		} catch (err) {
			console.error(
				`[outcome-evaluation] Sweep: deal ${deal.id.slice(0, 8)} eval failed:`,
				(err as Error).message,
			);
		}
	}

	// ── Recently completed goals ──
	const recentGoals = await db
		.select({
			id: goals.id,
			workspaceId: goals.workspaceId,
		})
		.from(goals)
		.where(
			and(
				eq(goals.status, 'completed'),
				sql`${goals.completedAt} IS NOT NULL`,
				sql`${goals.completedAt} >= ${since.toISOString()}::timestamptz`,
			),
		)
		.limit(500);

	for (const goal of recentGoals) {
		try {
			await evaluateGoal(goal.workspaceId, goal.id);
			counts.goals++;
		} catch (err) {
			console.error(
				`[outcome-evaluation] Sweep: goal ${goal.id.slice(0, 8)} eval failed:`,
				(err as Error).message,
			);
		}
	}

	// ── Recently completed introductions ──
	const recentIntros = await db
		.select({
			id: introductions.id,
			workspaceId: introductions.workspaceId,
		})
		.from(introductions)
		.where(
			and(
				eq(introductions.status, 'archive'),
				sql`${introductions.updatedAt} >= ${since.toISOString()}::timestamptz`,
			),
		)
		.limit(500);

	for (const intro of recentIntros) {
		try {
			await evaluateIntroduction(intro.workspaceId, intro.id);
			counts.introductions++;
		} catch (err) {
			console.error(
				`[outcome-evaluation] Sweep: intro ${intro.id.slice(0, 8)} eval failed:`,
				(err as Error).message,
			);
		}
	}

	console.log(
		`[outcome-evaluation] Sweep complete — deals=${counts.deals} goals=${counts.goals} intros=${counts.introductions}`,
	);
	return counts;
}

// ─── Event logging ────────────────────────────────────────────────────────────

outcomeEvaluationWorker.on('completed', (job) => {
	console.log(`[outcome-evaluation] Job ${job.id} completed`);
});
outcomeEvaluationWorker.on('failed', (job, err) => {
	console.error(`[outcome-evaluation] Job ${job?.id} failed:`, err.message);
});
