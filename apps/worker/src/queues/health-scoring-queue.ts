import { db, sql, workspaces } from '@repo/db';
import { Queue } from 'bullmq';
import { connection } from '../redis';

export interface HealthScoringJobData {
	keyEnvelope?: {
		encryptedWrk: string;
		kmsContext: Record<string, string>;
		wrkVersion: number;
	};
	workspaceId: string;
}

export interface HealthScoringFreshness {
	contactCount: number;
	scoreCount: number;
	missingScoreCount: number;
	oldestComputedAt: Date | null;
	newestComputedAt: Date | null;
}

export interface EnqueueHealthScoringOptions {
	force?: boolean;
	keyEnvelope?: HealthScoringJobData['keyEnvelope'];
	reason?: string;
	staleAfterMs?: number;
}

export interface EnqueueHealthScoringResult {
	workspaceId: string;
	queued: boolean;
	reason: string;
	jobId?: string;
	freshness: HealthScoringFreshness;
}

const DEFAULT_HEALTH_SCORING_STALE_MS = 60 * 60 * 1000;
const HEALTH_SCORING_DEDUPE_MS = 5 * 60 * 1000;

export const healthScoringQueue = new Queue<HealthScoringJobData>('health-scoring', {
	connection,
	prefix: '{ai-flow}',
	defaultJobOptions: {
		attempts: 2,
		backoff: { type: 'exponential', delay: 10000 },
		removeOnComplete: { count: 100 },
		removeOnFail: { count: 500 },
	},
});

function normalizeReason(reason: string): string {
	return reason.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'refresh';
}

function toDate(value: unknown): Date | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date;
}

export function resolveHealthScoringStaleAfterMs(
	env: Record<string, string | undefined> = process.env,
): number {
	const raw = env.HEALTH_SCORING_STALE_MINUTES?.trim();
	if (!raw) return DEFAULT_HEALTH_SCORING_STALE_MS;
	const minutes = Number(raw);
	if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_HEALTH_SCORING_STALE_MS;
	return Math.trunc(minutes * 60 * 1000);
}

export function isHealthScoringFresh(
	freshness: HealthScoringFreshness,
	staleAfterMs = resolveHealthScoringStaleAfterMs(),
	now = Date.now(),
): boolean {
	if (freshness.contactCount === 0) return true;
	if (freshness.scoreCount < freshness.contactCount) return false;
	if (!freshness.oldestComputedAt) return false;
	if (staleAfterMs <= 0) return false;
	return now - freshness.oldestComputedAt.getTime() < staleAfterMs;
}

export async function getHealthScoringFreshness(
	workspaceId: string,
): Promise<HealthScoringFreshness> {
	const rows = (await db.execute(sql`
		SELECT
			count(c.id)::int AS contact_count,
			count(h.contact_id)::int AS score_count,
			min(h.computed_at) AS oldest_computed_at,
			max(h.computed_at) AS newest_computed_at
		FROM contacts c
		LEFT JOIN contact_health_scores h
			ON h.workspace_id = c.workspace_id
			AND h.contact_id = c.id
		WHERE c.workspace_id = ${workspaceId}
	`)) as unknown as Array<{
		contact_count: number | string | null;
		score_count: number | string | null;
		oldest_computed_at: Date | string | null;
		newest_computed_at: Date | string | null;
	}>;

	const row = rows[0];
	const contactCount = Number(row?.contact_count ?? 0);
	const scoreCount = Number(row?.score_count ?? 0);

	return {
		contactCount,
		scoreCount,
		missingScoreCount: Math.max(0, contactCount - scoreCount),
		oldestComputedAt: toDate(row?.oldest_computed_at),
		newestComputedAt: toDate(row?.newest_computed_at),
	};
}

export async function enqueueHealthScoringForWorkspace(
	workspaceId: string,
	options: EnqueueHealthScoringOptions = {},
): Promise<EnqueueHealthScoringResult> {
	const reason = options.reason ?? 'stale_refresh';
	const staleAfterMs = options.staleAfterMs ?? resolveHealthScoringStaleAfterMs();
	const freshness = await getHealthScoringFreshness(workspaceId);

	if (!options.force && isHealthScoringFresh(freshness, staleAfterMs)) {
		return { workspaceId, queued: false, reason: 'fresh', freshness };
	}

	if (freshness.contactCount === 0) {
		return { workspaceId, queued: false, reason: 'no_contacts', freshness };
	}

	const bucket = Math.floor(Date.now() / HEALTH_SCORING_DEDUPE_MS);
	const jobId = `health-${normalizeReason(reason)}-${workspaceId}-${bucket}`;
	const job = await healthScoringQueue.add(
		'compute',
		{ workspaceId, ...(options.keyEnvelope ? { keyEnvelope: options.keyEnvelope } : {}) },
		{ jobId },
	);

	return {
		workspaceId,
		queued: true,
		reason,
		jobId: job.id,
		freshness,
	};
}

export async function queueHealthScoringForAllWorkspaces(
	options: EnqueueHealthScoringOptions = {},
): Promise<EnqueueHealthScoringResult[]> {
	const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);
	const results: EnqueueHealthScoringResult[] = [];

	for (const ws of allWorkspaces) {
		results.push(await enqueueHealthScoringForWorkspace(ws.id, options));
	}

	const queuedCount = results.filter((result) => result.queued).length;
	console.log(
		`[health-scoring] Queued scoring for ${queuedCount}/${allWorkspaces.length} workspaces`,
	);
	return results;
}
