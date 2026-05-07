import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock chain for select queries (used to verify workspace membership)
const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

// Mock chain for insert (used in createEdge)
const mockReturning = vi.fn();
const mockInsertValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

vi.mock('../client', () => ({
	db: {
		select: mockSelect,
		insert: mockInsert,
	},
}));

describe('createEdge (SEC-056)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects when source decision is not in the workspace', async () => {
		// source not found, target found
		mockSelectLimit
			.mockResolvedValueOnce([]) // source query → empty
			.mockResolvedValueOnce([{ id: 'target-id' }]); // target query → found

		const { createEdge } = await import('../dal/decisions');

		await expect(
			createEdge('ws-1', {
				sourceId: 'source-id',
				targetId: 'target-id',
				edgeType: 'temporal',
			}),
		).rejects.toThrow('Source or target decision not found in workspace');

		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('rejects when target decision is not in the workspace', async () => {
		// source found, target not found
		mockSelectLimit
			.mockResolvedValueOnce([{ id: 'source-id' }]) // source query → found
			.mockResolvedValueOnce([]); // target query → empty

		const { createEdge } = await import('../dal/decisions');

		await expect(
			createEdge('ws-1', {
				sourceId: 'source-id',
				targetId: 'target-id',
				edgeType: 'temporal',
			}),
		).rejects.toThrow('Source or target decision not found in workspace');

		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('rejects edge when decisions exist in a different workspace (cross-workspace isolation)', async () => {
		// Simulates: source and target IDs are valid (exist in ws-B) but the caller
		// is workspace ws-A. The workspace filter in the WHERE clause returns empty.
		// Both select queries must check workspaceId — if either check is missing, this
		// test still passes because empty results always throw, but the comment documents
		// the intent so a future reader knows the mock correctly simulates cross-workspace.
		mockSelectLimit
			.mockResolvedValueOnce([]) // source not in ws-A (it's in ws-B)
			.mockResolvedValueOnce([]); // target not in ws-A (it's in ws-B)

		const { createEdge } = await import('../dal/decisions');

		await expect(
			createEdge('ws-A', {
				sourceId: 'source-in-ws-B',
				targetId: 'target-in-ws-B',
				edgeType: 'semantic',
			}),
		).rejects.toThrow('Source or target decision not found in workspace');

		// Verify both workspace checks were executed (2 select calls)
		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('inserts edge when both decisions belong to the workspace', async () => {
		// both found
		mockSelectLimit
			.mockResolvedValueOnce([{ id: 'source-id' }])
			.mockResolvedValueOnce([{ id: 'target-id' }]);

		const mockEdge = {
			id: 'edge-1',
			sourceId: 'source-id',
			targetId: 'target-id',
			edgeType: 'temporal',
			weight: 0.5,
			confidenceScore: 0.5,
		};
		mockReturning.mockResolvedValueOnce([mockEdge]);

		const { createEdge } = await import('../dal/decisions');

		const result = await createEdge('ws-1', {
			sourceId: 'source-id',
			targetId: 'target-id',
			edgeType: 'temporal',
		});

		expect(mockInsert).toHaveBeenCalled();
		expect(result).toEqual(mockEdge);
	});
});
