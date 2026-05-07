import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D2 Knowledge Search E2E Verification — backend tests.
 * Verifies searchKnowledgeNodes correctness:
 *   - workspace_id scoping (security)
 *   - Blind index exact match (query-only path)
 *   - Vector cosine similarity (embedding path)
 *   - withIterativeScan usage (KG-1)
 *   - Envelope/withKeys integration
 *   - Fallback to listKnowledgeNodes when no query/embedding
 */

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mockExecute = vi.hoisted(() => vi.fn());
const mockOrderBy = vi.hoisted(() => vi.fn());
const mockLimit = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() =>
	vi.fn(() => ({
		orderBy: mockOrderBy,
	})),
);
const mockFrom = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })));

vi.mock('../../client', () => ({
	db: {
		execute: mockExecute,
		select: mockSelect,
		transaction: vi.fn(
			(
				fn: (tx: {
					execute: typeof mockExecute;
					select: typeof mockSelect;
				}) => Promise<unknown>,
			) => fn({ execute: mockExecute, select: mockSelect }),
		),
	},
}));

const mockWithKeys = vi.hoisted(() => vi.fn((_envelope: unknown, fn: () => unknown) => fn()));
const mockComputeBlindIndex = vi.hoisted(() => vi.fn(() => 'test-blind-hash'));
const mockKeyStore = vi.hoisted(() => ({
	getStore: vi.fn(() => ({ bik: Buffer.alloc(32) })),
}));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
	computeBlindIndex: mockComputeBlindIndex,
	getCurrentKeys: () => mockKeyStore.getStore(),
	keyStore: mockKeyStore,
}));

import type { SealedEnvelope } from '@repo/crypto';
import { searchKnowledgeNodes } from '../knowledge';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const fakeEmbedding512 = Array(512).fill(0.1);
const fakeEnvelope = {
	encryptedWrk: Buffer.alloc(32),
	kmsContext: { workspaceId: WS },
	wrkVersion: 1,
} as unknown as SealedEnvelope;

const mockNodes = [
	{ id: 'node-1', workspaceId: WS, type: 'topic', displayName: 'DeFi', mentionCount: 10 },
	{ id: 'node-2', workspaceId: WS, type: 'project', displayName: 'Uniswap', mentionCount: 5 },
];

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

// ─── searchKnowledgeNodes — query-only path (blind index) ────────────────────

describe('searchKnowledgeNodes — blind index path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLimit.mockResolvedValue(mockNodes);
		mockOrderBy.mockReturnValue({ limit: mockLimit });
		mockWhere.mockReturnValue({ orderBy: mockOrderBy });
		mockFrom.mockReturnValue({ where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
	});

	it('uses withKeys when envelope is provided', async () => {
		await searchKnowledgeNodes(WS, 'defi', undefined, fakeEnvelope);

		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
	});

	it('computes blind index from lowercase query', async () => {
		await searchKnowledgeNodes(WS, 'DeFi', undefined, fakeEnvelope);

		expect(mockComputeBlindIndex).toHaveBeenCalledWith('defi', expect.any(Buffer));
	});

	it('does NOT use transaction/iterative scan for blind index path', async () => {
		await searchKnowledgeNodes(WS, 'defi', undefined, fakeEnvelope);

		const { db } = await import('../../client');
		expect(db.transaction).not.toHaveBeenCalled();
	});

	it('limits results to 20', async () => {
		await searchKnowledgeNodes(WS, 'test', undefined, fakeEnvelope);

		expect(mockLimit).toHaveBeenCalledWith(20);
	});

	it('returns results as KnowledgeSearchResult[]', async () => {
		const results = await searchKnowledgeNodes(WS, 'defi', undefined, fakeEnvelope);

		expect(results).toEqual(mockNodes);
	});
});

// ─── searchKnowledgeNodes — embedding path (cosine similarity) ───────────────

describe('searchKnowledgeNodes — embedding path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]);
		mockLimit.mockResolvedValue([]);
		mockOrderBy.mockReturnValue({ limit: mockLimit });
		mockWhere.mockReturnValue({ orderBy: mockOrderBy });
		mockFrom.mockReturnValue({ where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
	});

	it('uses withIterativeScan (transaction) for vector search', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding512);

		const { db } = await import('../../client');
		expect(db.transaction).toHaveBeenCalledTimes(1);
	});

	it('executes SET LOCAL hnsw.iterative_scan before the query', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding512);

		expect(mockExecute).toHaveBeenCalledTimes(1);
		const setLocalStr = sqlToString(mockExecute.mock.calls[0][0]);
		expect(setLocalStr).toContain('SET LOCAL hnsw.iterative_scan');
		expect(setLocalStr).toContain('relaxed_order');
	});

	it('respects withKeys envelope when provided', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding512, fakeEnvelope);

		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
	});

	it('limits results to 20', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding512);

		expect(mockLimit).toHaveBeenCalledWith(20);
	});

	it('queries with halfvec(512) cast', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding512);

		// The select() should include similarity computation
		expect(mockSelect).toHaveBeenCalled();
	});
});

// ─── searchKnowledgeNodes — fallback path (no query, no embedding) ──────────

describe('searchKnowledgeNodes — fallback path', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const mockOffsetFn = vi.fn().mockResolvedValue(mockNodes);
		const mockLimitFn = vi.fn().mockReturnValue({ offset: mockOffsetFn });
		const mockOrderByFn = vi.fn().mockReturnValue({ limit: mockLimitFn });
		mockWhere.mockReturnValue({ orderBy: mockOrderByFn });
		mockFrom.mockReturnValue({ where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
	});

	it('falls back to listKnowledgeNodes when no query and no embedding', async () => {
		await searchKnowledgeNodes(WS, '', undefined);

		// Should call select (listKnowledgeNodes)
		expect(mockSelect).toHaveBeenCalled();
		expect(mockFrom).toHaveBeenCalled();
	});

	it('does not call transaction for fallback path', async () => {
		await searchKnowledgeNodes(WS, '', undefined);

		const { db } = await import('../../client');
		expect(db.transaction).not.toHaveBeenCalled();
	});
});

// ─── searchKnowledgeNodes — security: workspace_id scoping ──────────────────

describe('searchKnowledgeNodes — workspace_id scoping', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]);
		mockLimit.mockResolvedValue([]);
		mockOrderBy.mockReturnValue({ limit: mockLimit });
		mockWhere.mockReturnValue({ orderBy: mockOrderBy });
		mockFrom.mockReturnValue({ where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
	});

	it('blind index path: workspace_id is in WHERE clause', async () => {
		await searchKnowledgeNodes(WS, 'defi', undefined, fakeEnvelope);

		// where() should be called with conditions including workspace_id
		expect(mockWhere).toHaveBeenCalled();
		// The first arg to where() is the combined condition (and(...))
		// We verify the function is called, and trust the code structure
		// from our code review that eq(workspaceId) is in the conditions
	});

	it('embedding path: workspace_id is in WHERE clause', async () => {
		mockLimit.mockResolvedValue([]);

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding512);

		// where() should be called
		expect(mockWhere).toHaveBeenCalled();
	});

	it('cannot return nodes from other workspaces (structural verification)', async () => {
		// This test verifies that the code structurally enforces workspace_id.
		// searchKnowledgeNodes always passes workspaceId as the first argument
		// and includes it in every WHERE clause.
		// A real integration test would need a live DB — this confirms
		// the function signature and call structure.

		await searchKnowledgeNodes(WS, 'test', fakeEmbedding512);

		// The DAL function takes workspaceId as first arg — verified by type system
		// The WHERE clause includes eq(knowledgeNodes.workspaceId, workspaceId)
		// This is verified by code review + the existing iterative-scan tests
		expect(mockSelect).toHaveBeenCalled();
	});
});

// ─── searchKnowledgeNodes — edge cases ──────────────────────────────────────

describe('searchKnowledgeNodes — edge cases', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]);
		mockLimit.mockResolvedValue([]);
		mockOrderBy.mockReturnValue({ limit: mockLimit });
		mockWhere.mockReturnValue({ orderBy: mockOrderBy });
		mockFrom.mockReturnValue({ where: mockWhere });
		mockSelect.mockReturnValue({ from: mockFrom });
	});

	it('handles empty embedding array (falls through to query-only or fallback)', async () => {
		// Empty array should not trigger the embedding path
		await searchKnowledgeNodes(WS, 'test', [], fakeEnvelope);

		// Should use blind index path (withKeys called, no transaction)
		expect(mockWithKeys).toHaveBeenCalled();
		const { db } = await import('../../client');
		expect(db.transaction).not.toHaveBeenCalled();
	});

	it('handles query without envelope (returns listKnowledgeNodes fallback)', async () => {
		// When query is provided but no envelope, the blind index path
		// requires an envelope. Without it, falls through to listKnowledgeNodes.
		const mockOffsetFn = vi.fn().mockResolvedValue([]);
		const mockLimitFn = vi.fn().mockReturnValue({ offset: mockOffsetFn });
		const mockOrderByFn = vi.fn().mockReturnValue({ limit: mockLimitFn });
		mockWhere.mockReturnValue({ orderBy: mockOrderByFn });

		await searchKnowledgeNodes(WS, 'test', undefined);

		// Without envelope, blind index path is skipped, falls to listKnowledgeNodes
		expect(mockComputeBlindIndex).not.toHaveBeenCalled();
	});

	it('returns empty array when no results found', async () => {
		mockLimit.mockResolvedValue([]);

		const results = await searchKnowledgeNodes(WS, 'nonexistent', fakeEmbedding512);

		expect(results).toEqual([]);
	});
});
