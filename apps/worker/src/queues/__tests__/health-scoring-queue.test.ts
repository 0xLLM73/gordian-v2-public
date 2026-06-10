import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueueAdd = vi.hoisted(() => vi.fn());
const mockDbExecute = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());
const WORKSPACES_TABLE = vi.hoisted(() => ({
	id: 'id',
}));

vi.mock('bullmq', () => ({
	// biome-ignore lint/complexity/useArrowFunction: Vitest 4 class mocks must be constructible.
	Queue: vi.fn().mockImplementation(function () {
		return {
			add: mockQueueAdd,
		};
	}),
}));

vi.mock('../../redis', () => ({
	connection: {},
}));

vi.mock('@repo/db', () => ({
	db: {
		execute: mockDbExecute,
		select: mockDbSelect,
	},
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
	workspaces: WORKSPACES_TABLE,
}));

import {
	enqueueHealthScoringForWorkspace,
	isHealthScoringFresh,
	queueHealthScoringForAllWorkspaces,
	resolveHealthScoringStaleAfterMs,
} from '../health-scoring-queue';

function freshnessRow(input: {
	contactCount: number;
	newestComputedAt?: Date | null;
	oldestComputedAt?: Date | null;
	scoreCount: number;
}) {
	return {
		contact_count: input.contactCount,
		score_count: input.scoreCount,
		oldest_computed_at: input.oldestComputedAt ?? null,
		newest_computed_at: input.newestComputedAt ?? input.oldestComputedAt ?? null,
	};
}

describe('health-scoring queue freshness', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockQueueAdd.mockResolvedValue({ id: 'job-1' });
	});

	it('parses the stale window from minutes and falls back on invalid values', () => {
		expect(resolveHealthScoringStaleAfterMs({ HEALTH_SCORING_STALE_MINUTES: '2' })).toBe(120_000);
		expect(resolveHealthScoringStaleAfterMs({ HEALTH_SCORING_STALE_MINUTES: '-1' })).toBe(
			3_600_000,
		);
	});

	it('treats complete recent scores as fresh', () => {
		const now = Date.now();

		expect(
			isHealthScoringFresh(
				{
					contactCount: 2,
					scoreCount: 2,
					missingScoreCount: 0,
					oldestComputedAt: new Date(now - 5_000),
					newestComputedAt: new Date(now),
				},
				60_000,
				now,
			),
		).toBe(true);
	});

	it('treats missing or stale scores as not fresh', () => {
		const now = Date.now();

		expect(
			isHealthScoringFresh(
				{
					contactCount: 2,
					scoreCount: 1,
					missingScoreCount: 1,
					oldestComputedAt: new Date(now),
					newestComputedAt: new Date(now),
				},
				60_000,
				now,
			),
		).toBe(false);
		expect(
			isHealthScoringFresh(
				{
					contactCount: 2,
					scoreCount: 2,
					missingScoreCount: 0,
					oldestComputedAt: new Date(now - 90_000),
					newestComputedAt: new Date(now),
				},
				60_000,
				now,
			),
		).toBe(false);
	});

	it('skips queueing when a workspace has fresh complete scores', async () => {
		mockDbExecute.mockResolvedValueOnce([
			freshnessRow({
				contactCount: 2,
				scoreCount: 2,
				oldestComputedAt: new Date(),
			}),
		]);

		const result = await enqueueHealthScoringForWorkspace('ws-1', {
			reason: 'dashboard_open',
			staleAfterMs: 60_000,
		});

		expect(result).toEqual(
			expect.objectContaining({
				workspaceId: 'ws-1',
				queued: false,
				reason: 'fresh',
			}),
		);
		expect(mockQueueAdd).not.toHaveBeenCalled();
	});

	it('queues when scores are missing, stale, or explicitly forced', async () => {
		mockDbExecute.mockResolvedValueOnce([
			freshnessRow({
				contactCount: 3,
				scoreCount: 2,
				oldestComputedAt: new Date(),
			}),
		]);

		const missingResult = await enqueueHealthScoringForWorkspace('ws-2', {
			reason: 'telegram_sync_completed',
			staleAfterMs: 60_000,
		});

		expect(missingResult).toEqual(
			expect.objectContaining({
				workspaceId: 'ws-2',
				queued: true,
				reason: 'telegram_sync_completed',
				jobId: 'job-1',
			}),
		);
		expect(mockQueueAdd).toHaveBeenCalledWith(
			'compute',
			{ workspaceId: 'ws-2' },
			expect.objectContaining({
				jobId: expect.stringContaining('health-telegram_sync_completed-ws-2-'),
			}),
		);

		mockDbExecute.mockResolvedValueOnce([
			freshnessRow({
				contactCount: 1,
				scoreCount: 1,
				oldestComputedAt: new Date(),
			}),
		]);

		await enqueueHealthScoringForWorkspace('ws-2', {
			force: true,
			reason: 'manual_refresh',
			staleAfterMs: 60_000,
		});

		expect(mockQueueAdd).toHaveBeenCalledTimes(2);
	});

	it('queues only stale workspaces when scanning all workspaces', async () => {
		mockDbSelect.mockReturnValueOnce({
			from: vi.fn().mockResolvedValue([{ id: 'fresh-ws' }, { id: 'stale-ws' }]),
		});
		mockDbExecute
			.mockResolvedValueOnce([
				freshnessRow({
					contactCount: 1,
					scoreCount: 1,
					oldestComputedAt: new Date(),
				}),
			])
			.mockResolvedValueOnce([
				freshnessRow({
					contactCount: 2,
					scoreCount: 1,
					oldestComputedAt: new Date(),
				}),
			]);

		const results = await queueHealthScoringForAllWorkspaces({
			reason: 'open_app',
			staleAfterMs: 60_000,
		});

		expect(results).toHaveLength(2);
		expect(results.map((result) => result.queued)).toEqual([false, true]);
		expect(mockQueueAdd).toHaveBeenCalledTimes(1);
		expect(mockQueueAdd).toHaveBeenCalledWith(
			'compute',
			{ workspaceId: 'stale-ws' },
			expect.any(Object),
		);
	});
});
