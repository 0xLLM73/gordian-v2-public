import { describe, expect, it, vi } from 'vitest';
import {
	cleanupQueueJobsForDeletion,
	jobDataTargetsDeletedScope,
	runtimeCleanupQueueDefinitions,
	runtimeDeletionRedisPatterns,
} from '../runtime-cleanup';

const TARGET = {
	userId: '550e8400-e29b-41d4-a716-446655440001',
	workspaceId: '550e8400-e29b-41d4-a716-446655440000',
};

describe('runtime cleanup helpers', () => {
	it('matches only explicit userId/workspaceId fields in queued job data', () => {
		expect(jobDataTargetsDeletedScope({ userId: TARGET.userId }, TARGET)).toBe(true);
		expect(
			jobDataTargetsDeletedScope({ nested: { workspaceId: TARGET.workspaceId } }, TARGET),
		).toBe(true);
		expect(jobDataTargetsDeletedScope({ text: TARGET.userId }, TARGET)).toBe(false);
		expect(jobDataTargetsDeletedScope({ contactId: TARGET.workspaceId }, TARGET)).toBe(false);
	});

	it('removes only jobs whose payload targets the deleted scope', async () => {
		const matchingRemove = vi.fn().mockResolvedValue(undefined);
		const unrelatedRemove = vi.fn().mockResolvedValue(undefined);
		const queue = {
			name: 'sync',
			getJobs: vi.fn().mockResolvedValue([
				{ data: { workspaceId: TARGET.workspaceId }, remove: matchingRemove },
				{ data: { workspaceId: 'other-workspace' }, remove: unrelatedRemove },
			]),
		};

		const result = await cleanupQueueJobsForDeletion(queue, TARGET);

		expect(result).toMatchObject({
			queue: 'sync',
			scanned: 2,
			matched: 1,
			removed: 1,
			removeErrors: 0,
		});
		expect(matchingRemove).toHaveBeenCalledOnce();
		expect(unrelatedRemove).not.toHaveBeenCalled();
	});

	it('targets only deletion-scoped Redis key patterns', () => {
		expect(runtimeDeletionRedisPatterns(TARGET)).toEqual(
			expect.arrayContaining([
				`telegram:session:lock:${TARGET.userId}`,
				`telegram:session:blocked:${TARGET.userId}`,
				`tg:send:contact:${TARGET.workspaceId}:*`,
				`tg:send:hour:${TARGET.workspaceId}`,
				`tg:send:day:${TARGET.workspaceId}`,
				`tg:send:cooldown:${TARGET.workspaceId}:*`,
			]),
		);
	});

	it('includes Telegram history import jobs in account deletion cleanup', () => {
		expect(runtimeCleanupQueueDefinitions).toContainEqual({
			name: 'telegram-history-import',
			prefix: '{ai-flow}',
		});
	});
});
