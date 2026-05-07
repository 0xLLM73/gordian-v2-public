import { withWorkspaceRLS } from '@repo/db';
import type { Job, Processor } from 'bullmq';

/**
 * Wraps a BullMQ processor so every job runs inside withWorkspaceRLS.
 * Expects job.data.workspaceId — if missing, runs without RLS context.
 */
export function withRLS<T>(processor: Processor<T>): Processor<T> {
	return async (job: Job<T>, token?: string) => {
		const wsId = (job.data as Record<string, unknown>)?.workspaceId;
		if (typeof wsId === 'string') {
			return withWorkspaceRLS(wsId, () => processor(job, token));
		}
		return processor(job, token);
	};
}
