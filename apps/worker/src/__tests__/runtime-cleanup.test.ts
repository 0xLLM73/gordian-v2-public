import { describe, expect, it, vi } from 'vitest';
import {
	cleanupQueueJobsForDeletion,
	cleanupRedisKeysForDeletion,
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
		expect(jobDataTargetsDeletedScope({ workspace_id: TARGET.workspaceId }, TARGET)).toBe(true);
		expect(jobDataTargetsDeletedScope({ nested: { user_id: TARGET.userId } }, TARGET)).toBe(true);
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

	it('uses raw scoped Redis patterns for deletion but redacts them from summaries', async () => {
		const scannedPatterns: string[] = [];
		const redis: NonNullable<Parameters<typeof cleanupRedisKeysForDeletion>[1]> = {
			scan: vi.fn(async (_cursor: string, _match: 'MATCH', pattern: string) => {
				scannedPatterns.push(pattern);
				return ['0', [`matched:${scannedPatterns.length}`]] as [string, string[]];
			}),
			pipeline: vi.fn(() => ({
				del: vi.fn(),
				exec: vi.fn(async () => [[null, 1] as [Error | null, unknown]]),
			})),
		};

		const result = await cleanupRedisKeysForDeletion(TARGET, redis);

		expect(scannedPatterns).toEqual(runtimeDeletionRedisPatterns(TARGET));
		expect(result).toEqual(
			runtimeDeletionRedisPatterns(TARGET).map((pattern) => ({
				changed: 1,
				matched: 1,
				pattern: pattern
					.replaceAll(TARGET.workspaceId, '[workspace]')
					.replaceAll(TARGET.userId, '[user]'),
			})),
		);
		expect(JSON.stringify(result)).not.toContain(TARGET.workspaceId);
		expect(JSON.stringify(result)).not.toContain(TARGET.userId);
	});
});
