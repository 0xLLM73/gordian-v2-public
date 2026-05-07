import { beforeEach, describe, expect, it, vi } from 'vitest';

const processorStore = vi.hoisted((): { fn: ((job: unknown) => Promise<void>) | null } => ({
	fn: null,
}));

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockComputeRecommendations = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@repo/db', () => ({
	db: { select: mockDbSelect },
	workspaces: {},
	eq: vi.fn(),
}));

vi.mock('../../ai/recommendations', () => ({
	computeRecommendations: mockComputeRecommendations,
}));

vi.mock('bullmq', () => ({
	Worker: vi.fn(function MockWorker(name: string, processor: (job: unknown) => Promise<void>) {
		if (name === 'recommendations') processorStore.fn = processor;
		return { on: vi.fn() };
	}),
	Queue: vi.fn(function MockQueue() {
		return { add: vi.fn(() => Promise.resolve()), on: vi.fn() };
	}),
}));

vi.mock('../../redis', () => ({ connection: {} }));

import '../../queues/recommendations';

const WORKSPACE_ID = 'ws-test-1234-abcd-5678-efgh-000000000000';
const MOCK_WORKSPACE_ROW = {
	encryptedWrk: Buffer.from('fake-encrypted-wrk').toString('base64'),
	kmsContext: JSON.stringify({ WorkspaceId: WORKSPACE_ID }),
	wrkVersion: 1,
};

function mockDbReturning(rows: unknown[]) {
	mockDbSelect.mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue(rows),
			}),
		}),
	});
}

describe('recommendationsWorker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('skips computation when workspace not found in DB', async () => {
		mockDbReturning([]);

		await processorStore.fn?.({ data: { workspaceId: WORKSPACE_ID } });

		expect(mockComputeRecommendations).not.toHaveBeenCalled();
	});

	it('calls computeRecommendations when envelope resolved from DB', async () => {
		mockDbReturning([MOCK_WORKSPACE_ROW]);

		await processorStore.fn?.({ data: { workspaceId: WORKSPACE_ID } });

		expect(mockComputeRecommendations).toHaveBeenCalledWith(
			WORKSPACE_ID,
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});
});
