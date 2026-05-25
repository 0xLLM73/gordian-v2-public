import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCleanupRuntimeStateForDeletion = vi.hoisted(() => vi.fn());

vi.mock('../../runtime-cleanup', () => ({
	cleanupRuntimeStateForDeletion: mockCleanupRuntimeStateForDeletion,
}));

process.env.WORKER_INTERNAL_SECRET = 'test-secret';

const SECRET = 'test-secret';
const WRONG_SECRET = 'bad-secret';
const VALID_BODY = {
	userId: '550e8400-e29b-41d4-a716-446655440001',
	workspaceId: '550e8400-e29b-41d4-a716-446655440000',
};

describe('POST /runtime/cleanup-deletion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCleanupRuntimeStateForDeletion.mockResolvedValue({
			queues: [{ queue: 'sync', scanned: 1, matched: 1, removed: 1, removeErrors: 0 }],
			redis: [{ pattern: 'tg:send:hour:*', matched: 1, changed: 1 }],
		});
	});

	it('returns 401 when X-Internal-Secret header is missing', async () => {
		const { runtimeCleanup } = await import('../../routes/runtime-cleanup');
		const res = await runtimeCleanup.request('/cleanup-deletion', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(401);
		expect(mockCleanupRuntimeStateForDeletion).not.toHaveBeenCalled();
	});

	it('returns 401 when X-Internal-Secret is wrong', async () => {
		const { runtimeCleanup } = await import('../../routes/runtime-cleanup');
		const res = await runtimeCleanup.request('/cleanup-deletion', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': WRONG_SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(401);
		expect(mockCleanupRuntimeStateForDeletion).not.toHaveBeenCalled();
	});

	it('returns 400 for invalid identifiers', async () => {
		const { runtimeCleanup } = await import('../../routes/runtime-cleanup');
		const res = await runtimeCleanup.request('/cleanup-deletion', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify({ userId: 'not-a-uuid', workspaceId: VALID_BODY.workspaceId }),
		});

		expect(res.status).toBe(400);
		expect(mockCleanupRuntimeStateForDeletion).not.toHaveBeenCalled();
	});

	it('runs runtime cleanup for a valid deletion scope', async () => {
		const { runtimeCleanup } = await import('../../routes/runtime-cleanup');
		const res = await runtimeCleanup.request('/cleanup-deletion', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': SECRET,
			},
			body: JSON.stringify(VALID_BODY),
		});

		expect(res.status).toBe(200);
		expect(mockCleanupRuntimeStateForDeletion).toHaveBeenCalledWith(VALID_BODY);
		const json = (await res.json()) as { queues: Array<{ queue: string; removed: number }> };
		expect(json.queues[0]).toMatchObject({ queue: 'sync', removed: 1 });
	});
});
