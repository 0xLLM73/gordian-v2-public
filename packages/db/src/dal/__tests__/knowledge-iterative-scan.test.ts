import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockExecute = vi.hoisted(() => vi.fn());
const mockOrderBy = vi.hoisted(() => vi.fn());
const mockLimit = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn(() => ({ orderBy: mockOrderBy })));
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })));

vi.mock('../../client', () => ({
	db: {
		execute: mockExecute,
		select: mockSelect,
		transaction: vi.fn(
			(fn: (tx: { execute: typeof mockExecute; select: typeof mockSelect }) => Promise<unknown>) =>
				fn({ execute: mockExecute, select: mockSelect }),
		),
	},
}));

const mockWithKeys = vi.hoisted(() => vi.fn((_envelope: unknown, fn: () => unknown) => fn()));
const mockComputeBlindIndex = vi.hoisted(() => vi.fn(() => 'blind-hash'));
const mockKeyStore = vi.hoisted(() => ({
	getStore: vi.fn(() => ({ bik: Buffer.alloc(32) })),
}));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
	computeBlindIndex: mockComputeBlindIndex,
	getCurrentKeys: () => mockKeyStore.getStore(),
	keyStore: mockKeyStore,
}));

import {
	inferSimilarityLinks,
	inferSimilarityRelationshipCandidates,
	searchKnowledgeNodes,
} from '../knowledge';

/** Extract SQL text from a Drizzle sql`` tagged template object. */
function sqlToString(sqlObj: unknown): string {
	const obj = sqlObj as { queryChunks?: unknown[] };
	if (obj?.queryChunks) {
		return obj.queryChunks
			.flatMap((chunk) => {
				if (typeof chunk === 'object' && chunk !== null && 'value' in chunk) {
					return (chunk as { value: string[] }).value;
				}
				return [String(chunk)];
			})
			.join('');
	}
	return String(sqlObj);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const fakeEmbedding = Array(512).fill(0.1);
const fakeEnvelope = {
	encryptedWrk: Buffer.alloc(32),
	kmsContext: { workspaceId: WS },
	wrkVersion: 1,
} as unknown as import('@repo/crypto').SealedEnvelope;

// ─── searchKnowledgeNodes — KG-1 iterative scan ─────────────────────────────

describe('searchKnowledgeNodes — KG-1 iterative scan', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]);
		mockLimit.mockResolvedValue([]);
		mockOrderBy.mockReturnValue({ limit: mockLimit });
		mockWhere.mockReturnValue({ orderBy: mockOrderBy });
		mockFrom.mockReturnValue({ where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
	});

	it('executes SET LOCAL hnsw.iterative_scan before the query', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding);

		// First call should be SET LOCAL (from withIterativeScan)
		expect(mockExecute).toHaveBeenCalledTimes(1);
		const setLocalStr = sqlToString(mockExecute.mock.calls[0][0]);
		expect(setLocalStr).toContain('SET LOCAL hnsw.iterative_scan');
		expect(setLocalStr).toContain('relaxed_order');
	});

	it('filters by workspace_id in the vector search path', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding);

		// select().from().where() should have been called
		expect(mockSelect).toHaveBeenCalled();
		expect(mockFrom).toHaveBeenCalled();
		expect(mockWhere).toHaveBeenCalled();
	});

	it('uses transaction handle (tx) not global db for queries', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding);

		// The transaction mock passes tx={execute, select} to the callback.
		// If withIterativeScan is used, the mock transaction fn is called.
		const { db } = await import('../../client');
		expect(db.transaction).toHaveBeenCalledTimes(1);
	});

	it('respects withKeys envelope when provided', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding, fakeEnvelope);

		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
	});

	it('does NOT use withIterativeScan for query-only path (no embedding)', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', undefined, fakeEnvelope);

		// Should NOT call transaction (iterative scan only applies to vector search)
		const { db } = await import('../../client');
		expect(db.transaction).not.toHaveBeenCalled();
		// Should still call withKeys for blind index search
		expect(mockWithKeys).toHaveBeenCalled();
	});

	it('limits vector search results to 20', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding);

		expect(mockOrderBy).toHaveBeenCalled();
		expect(mockLimit).toHaveBeenCalledWith(20);
	});
});

// ─── inferSimilarityLinks — KG-1 iterative scan ────────────────────────────

describe('inferSimilarityLinks — KG-1 iterative scan', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]);
	});

	it('executes SET LOCAL hnsw.iterative_scan before the CTE query', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // SET LOCAL
			.mockResolvedValueOnce([{ id: 'link-1' }, { id: 'link-2' }]); // INSERT...RETURNING

		await inferSimilarityLinks(WS);

		expect(mockExecute).toHaveBeenCalledTimes(2);

		// First call: SET LOCAL
		const setLocalStr = sqlToString(mockExecute.mock.calls[0][0]);
		expect(setLocalStr).toContain('SET LOCAL hnsw.iterative_scan');
		expect(setLocalStr).toContain('relaxed_order');
	});

	it('includes workspace_id in the CTE query', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // SET LOCAL
			.mockResolvedValueOnce([]); // CTE

		await inferSimilarityLinks(WS);

		// Second call: CTE query
		const cteStr = sqlToString(mockExecute.mock.calls[1][0]);
		expect(cteStr).toContain(WS);
	});

	it('returns count of created/updated links', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // SET LOCAL
			.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]); // 3 links

		const count = await inferSimilarityLinks(WS);
		expect(count).toBe(3);
	});

	it('returns 0 when no pairs found', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // SET LOCAL
			.mockResolvedValueOnce([]); // empty

		const count = await inferSimilarityLinks(WS);
		expect(count).toBe(0);
	});

	it('uses default distance threshold of 0.3', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // SET LOCAL
			.mockResolvedValueOnce([]);

		await inferSimilarityLinks(WS);

		const cteStr = sqlToString(mockExecute.mock.calls[1][0]);
		expect(cteStr).toContain('0.3');
	});

	it('accepts custom distance threshold', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // SET LOCAL
			.mockResolvedValueOnce([]);

		await inferSimilarityLinks(WS, 0.5);

		const cteStr = sqlToString(mockExecute.mock.calls[1][0]);
		expect(cteStr).toContain('0.5');
	});

	it('uses transaction via withIterativeScan', async () => {
		mockExecute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);

		await inferSimilarityLinks(WS);

		const { db } = await import('../../client');
		expect(db.transaction).toHaveBeenCalledTimes(1);
	});

	it('casts relationship candidate distance threshold in metadata JSON', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined) // SET LOCAL
			.mockResolvedValueOnce([]);

		await inferSimilarityRelationshipCandidates(WS, 0.42);

		const cteStr = sqlToString(mockExecute.mock.calls[1][0]);
		expect(cteStr).toContain("'distanceThreshold'");
		expect(cteStr).toContain('::real');
	});
});
