import { Queue } from 'bullmq';
import { connection } from './redis';

export type RuntimeCleanupTarget = {
	userId: string;
	workspaceId: string;
};

export type QueueCleanupSummary = {
	queue: string;
	scanned: number;
	matched: number;
	removed: number;
	removeErrors: number;
};

export type RedisCleanupSummary = {
	changed: number;
	matched: number;
	pattern: string;
};

export type RuntimeCleanupSummary = {
	queues: QueueCleanupSummary[];
	redis: RedisCleanupSummary[];
};

type RuntimeCleanupJob = {
	data: unknown;
	remove: () => Promise<void>;
};

type RuntimeCleanupQueue = {
	name: string;
	getJobs: (
		types: string[],
		start?: number,
		end?: number,
		asc?: boolean,
	) => Promise<RuntimeCleanupJob[]>;
	close?: () => Promise<void>;
};

type RedisCleanupConnection = {
	scan: (
		cursor: string,
		match: 'MATCH',
		pattern: string,
		count: 'COUNT',
		countValue: number,
	) => Promise<[string, string[]]>;
	pipeline: () => {
		del: (key: string) => unknown;
		exec: () => Promise<Array<[Error | null, unknown]> | null>;
	};
};

export const runtimeCleanupQueueDefinitions = [
	'sync',
	'telegram-history-import',
	'backfill',
	'embedding-backfill',
	'briefs',
	'rotation',
	'digests',
	'health-scoring',
	'orchestrator',
	'extraction',
	'embeddings',
	'summaries',
	'fulfillment',
	'goal-extraction',
	'goal-decomposition',
	'knowledge-extraction',
	'knowledge-inference',
	'relationship-extraction',
	'style-analysis',
	'style-aggregation',
	'decision-recording',
	'rationale-extraction',
	'recommendations',
	'outcome-evaluation',
	'deal-detection',
	'investor-patterns',
	'batch-flush',
	'diff-embedding',
	'pattern-aggregation',
].map((name) => ({ name, prefix: '{ai-flow}' }));

const runtimeCleanupJobStates = [
	'waiting',
	'delayed',
	'paused',
	'completed',
	'failed',
	'waiting-children',
	'prioritized',
];

export function jobDataTargetsDeletedScope(
	data: unknown,
	target: RuntimeCleanupTarget,
	depth = 0,
): boolean {
	if (depth > 5 || data === null || typeof data !== 'object') return false;

	if (Array.isArray(data)) {
		return data.some((value) => jobDataTargetsDeletedScope(value, target, depth + 1));
	}

	for (const [key, value] of Object.entries(data)) {
		if (key === 'workspaceId' && value === target.workspaceId) return true;
		if (key === 'userId' && value === target.userId) return true;
		if (typeof value === 'object' && jobDataTargetsDeletedScope(value, target, depth + 1)) {
			return true;
		}
	}

	return false;
}

export async function cleanupQueueJobsForDeletion(
	queue: RuntimeCleanupQueue,
	target: RuntimeCleanupTarget,
): Promise<QueueCleanupSummary> {
	const jobs = await queue.getJobs(runtimeCleanupJobStates, 0, -1, true);
	let matched = 0;
	let removed = 0;
	let removeErrors = 0;

	for (const job of jobs) {
		if (!jobDataTargetsDeletedScope(job.data, target)) continue;

		matched += 1;
		try {
			await job.remove();
			removed += 1;
		} catch {
			removeErrors += 1;
		}
	}

	return {
		queue: queue.name,
		scanned: jobs.length,
		matched,
		removed,
		removeErrors,
	};
}

export function runtimeDeletionRedisPatterns(target: RuntimeCleanupTarget): string[] {
	return [
		`telegram:session:lock:${target.userId}`,
		`telegram:session:blocked:${target.userId}`,
		`tg:send:contact:${target.workspaceId}:*`,
		`tg:send:hour:${target.workspaceId}`,
		`tg:send:day:${target.workspaceId}`,
		`tg:send:cooldown:${target.workspaceId}:*`,
	];
}

async function deleteRedisPattern(
	redis: RedisCleanupConnection,
	pattern: string,
): Promise<RedisCleanupSummary> {
	let cursor = '0';
	let matched = 0;
	let changed = 0;

	do {
		const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
		cursor = nextCursor;
		matched += keys.length;

		if (keys.length > 0) {
			const pipeline = redis.pipeline();
			for (const key of keys) pipeline.del(key);
			const responses = await pipeline.exec();
			changed +=
				responses?.reduce((total, [error, value]) => total + (error ? 0 : Number(value ?? 0)), 0) ??
				0;
		}
	} while (cursor !== '0');

	return { changed, matched, pattern };
}

export async function cleanupRedisKeysForDeletion(
	target: RuntimeCleanupTarget,
	redis: RedisCleanupConnection = connection as unknown as RedisCleanupConnection,
): Promise<RedisCleanupSummary[]> {
	const results: RedisCleanupSummary[] = [];
	for (const pattern of runtimeDeletionRedisPatterns(target)) {
		results.push(await deleteRedisPattern(redis, pattern));
	}
	return results;
}

export async function cleanupRuntimeQueuesForDeletion(
	target: RuntimeCleanupTarget,
	queueDefinitions = runtimeCleanupQueueDefinitions,
): Promise<QueueCleanupSummary[]> {
	const results: QueueCleanupSummary[] = [];

	for (const definition of queueDefinitions) {
		const queueConnection = connection.duplicate();
		const queue = new Queue(definition.name, {
			connection: queueConnection,
			prefix: definition.prefix,
		}) as unknown as RuntimeCleanupQueue;

		try {
			results.push(await cleanupQueueJobsForDeletion(queue, target));
		} finally {
			await queue.close?.();
			await queueConnection.quit().catch(() => undefined);
		}
	}

	return results;
}

export async function cleanupRuntimeStateForDeletion(
	target: RuntimeCleanupTarget,
): Promise<RuntimeCleanupSummary> {
	const [queues, redis] = await Promise.all([
		cleanupRuntimeQueuesForDeletion(target),
		cleanupRedisKeysForDeletion(target),
	]);

	return { queues, redis };
}
