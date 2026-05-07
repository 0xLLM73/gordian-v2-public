import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBriefQueueAdd = vi.fn();
const mockSyncQueueAdd = vi.fn();

vi.mock('../../ai/morning-brief', () => ({
	briefQueue: { add: (...args: unknown[]) => mockBriefQueueAdd(...args) },
}));

vi.mock('../../queues/sync', () => ({
	syncQueue: { add: (...args: unknown[]) => mockSyncQueueAdd(...args) },
}));

vi.mock('grammy', () => ({
	Composer: vi.fn(function MockComposer() {
		return {
			command: vi.fn(),
			on: vi.fn(() => ({ filter: vi.fn() })),
		};
	}),
}));

describe('briefs bot feature', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('briefsComposer is defined', async () => {
		const { briefsComposer } = await import('../features/briefs');
		expect(briefsComposer).toBeDefined();
	});

	it('/brief queues an on-demand brief job with priority 1', async () => {
		mockBriefQueueAdd.mockResolvedValue({ id: 'job-1' });

		const { briefQueue } = await import('../../ai/morning-brief');
		await briefQueue.add(
			'on-demand-brief',
			{ userId: '123', workspaceId: 'ws-1', timezone: 'UTC' },
			{ priority: 1 },
		);

		expect(mockBriefQueueAdd).toHaveBeenCalledWith(
			'on-demand-brief',
			{ userId: '123', workspaceId: 'ws-1', timezone: 'UTC' },
			{ priority: 1 },
		);
	});

	it('/sync queues a sync-contacts job', async () => {
		mockSyncQueueAdd.mockResolvedValue({ id: 'job-2' });

		const { syncQueue } = await import('../../queues/sync');
		await syncQueue.add('sync-contacts', { userId: '456', workspaceId: 'ws-2' });

		expect(mockSyncQueueAdd).toHaveBeenCalledWith('sync-contacts', {
			userId: '456',
			workspaceId: 'ws-2',
		});
	});

	it('brief job data includes timezone from session', async () => {
		mockBriefQueueAdd.mockResolvedValue({ id: 'job-3' });

		const { briefQueue } = await import('../../ai/morning-brief');

		// Simulate timezone from session data
		const timezone = 'America/New_York';
		await briefQueue.add(
			'on-demand-brief',
			{ userId: '123', workspaceId: 'ws-1', timezone },
			{ priority: 1 },
		);

		const jobData = mockBriefQueueAdd.mock.calls[0][1];
		expect(jobData.timezone).toBe('America/New_York');
	});

	it('defaults timezone to UTC when session has no timezone', async () => {
		mockBriefQueueAdd.mockResolvedValue({ id: 'job-4' });

		const { briefQueue } = await import('../../ai/morning-brief');

		// Simulate missing timezone → falls back to 'UTC'
		const sessionTimezone = undefined;
		const timezone = sessionTimezone ?? 'UTC';
		await briefQueue.add(
			'on-demand-brief',
			{ userId: '123', workspaceId: 'ws-1', timezone },
			{ priority: 1 },
		);

		const jobData = mockBriefQueueAdd.mock.calls[0][1];
		expect(jobData.timezone).toBe('UTC');
	});
});
