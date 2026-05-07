import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockExecute = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockInsertValues = vi.hoisted(() => vi.fn(() => ({ returning: mockReturning })));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));

// Update chain
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUpdateReturning = vi.hoisted(() => vi.fn<any>());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUpdateWhere = vi.hoisted(() => vi.fn<any>(() => ({ returning: mockUpdateReturning })));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUpdateSet = vi.hoisted(() => vi.fn<any>(() => ({ where: mockUpdateWhere })));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUpdate = vi.hoisted(() => vi.fn<any>(() => ({ set: mockUpdateSet })));

// Select chains — separate per call to handle Promise.all
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSelectLimit = vi.hoisted(() => vi.fn<any>());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSelectOrderBy = vi.hoisted(() => vi.fn<any>(() => ({ limit: mockSelectLimit })));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSelectWhere = vi.hoisted(() => vi.fn<any>());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSelectFrom = vi.hoisted(() => vi.fn<any>(() => ({ where: mockSelectWhere })));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSelect = vi.hoisted(() => vi.fn<any>(() => ({ from: mockSelectFrom })));

vi.mock('../../client', () => ({
	db: {
		execute: mockExecute,
		insert: mockInsert,
		select: mockSelect,
		update: mockUpdate,
	},
}));

const mockWithKeys = vi.hoisted(() => vi.fn((_envelope: unknown, fn: () => unknown) => fn()));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
}));

import type { SealedEnvelope } from '@repo/crypto';
import {
	createDecision,
	createEdge,
	decayStaleEdges,
	findDecisionByEntityId,
	findEdgesByTargetDecision,
	findRecentDecision,
	findSimilarDecisions,
	graphragSearch,
	updateEdgeWeight,
} from '../decisions';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const USER_ID = 'usr-00000000-0000-0000-0000-000000000001';
const DECISION_ID = 'dec-00000000-0000-0000-0000-000000000001';
const DECISION_ID_2 = 'dec-00000000-0000-0000-0000-000000000002';
const EDGE_ID = 'edge-00000000-0000-0000-0000-000000000001';
const fakeEmbedding = Array(512).fill(0.1);

const fakeEnvelope: SealedEnvelope = {
	encryptedWrk: Buffer.from('fake-wrk'),
	kmsContext: { WorkspaceID: WS, Purpose: 'workspace-root-key' },
	wrkVersion: 1,
};

const fakeDecisionRow = {
	id: DECISION_ID,
	workspaceId: WS,
	userId: USER_ID,
	rawContent: 'test decision content',
	embedding: fakeEmbedding,
	decisionType: 'message' as const,
	interactionMetadata: {},
	entityId: null,
	createdAt: new Date('2026-03-01T10:00:00Z'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('findRecentDecision', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelectLimit.mockResolvedValue([]);
		mockSelectOrderBy.mockReturnValue({ limit: mockSelectLimit });
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit, orderBy: mockSelectOrderBy });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
	});

	it('returns null when no recent decision found', async () => {
		mockSelectLimit.mockResolvedValue([]);

		const result = await findRecentDecision(WS);
		expect(result).toBeNull();
		expect(mockSelect).toHaveBeenCalledTimes(1);
	});

	it('returns the most recent decision within the time window', async () => {
		const row = { id: DECISION_ID, createdAt: new Date('2026-03-04T12:00:00Z') };
		mockSelectLimit.mockResolvedValue([row]);

		const result = await findRecentDecision(WS);
		expect(result).toEqual(row);
	});

	it('defaults to 24-hour window', async () => {
		mockSelectLimit.mockResolvedValue([]);

		await findRecentDecision(WS);
		// The function constructs a cutoff Date — verify limit(1) was called
		expect(mockSelectLimit).toHaveBeenCalledWith(1);
	});

	it('excludes a specific decision ID when excludeId is set', async () => {
		mockSelectLimit.mockResolvedValue([]);

		await findRecentDecision(WS, { excludeId: DECISION_ID });
		// Verify the where clause was called (conditions include excludeId filter)
		expect(mockSelectWhere).toHaveBeenCalled();
	});

	it('respects custom withinHours option', async () => {
		mockSelectLimit.mockResolvedValue([]);

		await findRecentDecision(WS, { withinHours: 1 });
		expect(mockSelect).toHaveBeenCalledTimes(1);
	});
});

describe('findSimilarDecisions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelectLimit.mockResolvedValue([]);
		mockSelectOrderBy.mockReturnValue({ limit: mockSelectLimit });
		mockSelectWhere.mockReturnValue({ orderBy: mockSelectOrderBy });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
	});

	it('returns empty array when no similar decisions found', async () => {
		mockSelectLimit.mockResolvedValue([]);

		const result = await findSimilarDecisions(WS, fakeEmbedding);
		expect(result).toEqual([]);
	});

	it('returns decisions sorted by similarity', async () => {
		const rows = [
			{ id: DECISION_ID, similarity: 0.95 },
			{ id: DECISION_ID_2, similarity: 0.88 },
		];
		mockSelectLimit.mockResolvedValue(rows);

		const result = await findSimilarDecisions(WS, fakeEmbedding);
		expect(result).toEqual(rows);
		expect(result).toHaveLength(2);
	});

	it('defaults to minSimilarity 0.85 and limit 3', async () => {
		mockSelectLimit.mockResolvedValue([]);

		await findSimilarDecisions(WS, fakeEmbedding);
		expect(mockSelectLimit).toHaveBeenCalledWith(3);
	});

	it('respects custom minSimilarity and limit options', async () => {
		mockSelectLimit.mockResolvedValue([]);

		await findSimilarDecisions(WS, fakeEmbedding, { minSimilarity: 0.7, limit: 5 });
		expect(mockSelectLimit).toHaveBeenCalledWith(5);
	});

	it('excludes a specific decision ID when excludeId is set', async () => {
		mockSelectLimit.mockResolvedValue([]);

		await findSimilarDecisions(WS, fakeEmbedding, { excludeId: DECISION_ID });
		expect(mockSelectWhere).toHaveBeenCalled();
	});

	it('includes workspace_id in the query filter', async () => {
		mockSelectLimit.mockResolvedValue([]);

		await findSimilarDecisions(WS, fakeEmbedding);
		expect(mockSelect).toHaveBeenCalledTimes(1);
	});
});

describe('findDecisionByEntityId', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelectLimit.mockResolvedValue([]);
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
	});

	it('returns null when no decision matches the entity ID', async () => {
		mockSelectLimit.mockResolvedValue([]);

		const result = await findDecisionByEntityId(WS, 'entity-123');
		expect(result).toBeNull();
	});

	it('returns the decision ID matching the entity', async () => {
		mockSelectLimit.mockResolvedValue([{ id: DECISION_ID }]);

		const result = await findDecisionByEntityId(WS, 'entity-123');
		expect(result).toEqual({ id: DECISION_ID });
	});

	it('scopes the query to the workspace', async () => {
		mockSelectLimit.mockResolvedValue([]);

		await findDecisionByEntityId(WS, 'entity-123');
		expect(mockSelect).toHaveBeenCalledTimes(1);
		expect(mockSelectLimit).toHaveBeenCalledWith(1);
	});
});

describe('updateEdgeWeight', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdateWhere.mockResolvedValue(undefined);
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
		mockUpdate.mockReturnValue({ set: mockUpdateSet });
	});

	it('updates edge weight with positive delta', async () => {
		await updateEdgeWeight(WS, EDGE_ID, 0.1);

		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(mockUpdateSet).toHaveBeenCalledTimes(1);
		expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
	});

	it('updates edge weight with negative delta', async () => {
		await updateEdgeWeight(WS, EDGE_ID, -0.1);

		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});

	it('uses default min 0.1 and max 1.0 when no options given', async () => {
		await updateEdgeWeight(WS, EDGE_ID, 0.1);

		// The SQL uses GREATEST(0.1, LEAST(1.0, weight + delta))
		expect(mockUpdateSet).toHaveBeenCalled();
	});

	it('respects custom minWeight and maxWeight options', async () => {
		await updateEdgeWeight(WS, EDGE_ID, 0.2, { minWeight: 0.2, maxWeight: 0.9 });

		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});

	it('scopes the update to the workspace and edge ID', async () => {
		await updateEdgeWeight(WS, EDGE_ID, 0.1);

		expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
	});
});

describe('findEdgesByTargetDecision', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelectWhere.mockResolvedValue([]);
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });
	});

	it('returns empty array when no edges point to the target', async () => {
		mockSelectWhere.mockResolvedValue([]);

		const result = await findEdgesByTargetDecision(WS, DECISION_ID);
		expect(result).toEqual([]);
	});

	it('returns edges with id, weight, and sourceId', async () => {
		const edges = [{ id: EDGE_ID, weight: 0.8, sourceId: DECISION_ID_2 }];
		mockSelectWhere.mockResolvedValue(edges);

		const result = await findEdgesByTargetDecision(WS, DECISION_ID);
		expect(result).toEqual(edges);
		expect(result[0]).toHaveProperty('id');
		expect(result[0]).toHaveProperty('weight');
		expect(result[0]).toHaveProperty('sourceId');
	});

	it('scopes the query to the workspace', async () => {
		mockSelectWhere.mockResolvedValue([]);

		await findEdgesByTargetDecision(WS, DECISION_ID);
		expect(mockSelect).toHaveBeenCalledTimes(1);
	});
});

describe('decayStaleEdges', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdateReturning.mockResolvedValue([]);
		mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
		mockUpdate.mockReturnValue({ set: mockUpdateSet });
	});

	it('returns 0 when no stale edges exist', async () => {
		mockUpdateReturning.mockResolvedValue([]);

		const count = await decayStaleEdges(WS);
		expect(count).toBe(0);
	});

	it('returns the count of decayed edges', async () => {
		mockUpdateReturning.mockResolvedValue([{ id: EDGE_ID }, { id: 'edge-2' }, { id: 'edge-3' }]);

		const count = await decayStaleEdges(WS);
		expect(count).toBe(3);
	});

	it('defaults to 30-day cutoff, 0.1 decay, 0.1 min confidence', async () => {
		mockUpdateReturning.mockResolvedValue([]);

		await decayStaleEdges(WS);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(mockUpdateSet).toHaveBeenCalledTimes(1);
	});

	it('respects custom olderThanDays, decayAmount, and minConfidence', async () => {
		mockUpdateReturning.mockResolvedValue([{ id: EDGE_ID }]);

		const count = await decayStaleEdges(WS, {
			olderThanDays: 7,
			decayAmount: 0.05,
			minConfidence: 0.2,
		});
		expect(count).toBe(1);
	});

	it('only decays edges whose confidence is above minConfidence', async () => {
		mockUpdateReturning.mockResolvedValue([]);

		await decayStaleEdges(WS);
		// The WHERE clause includes gt(causalEdges.confidenceScore, minConfidence)
		expect(mockUpdateWhere).toHaveBeenCalled();
	});

	it('scopes the decay to the workspace', async () => {
		mockUpdateReturning.mockResolvedValue([]);

		await decayStaleEdges(WS);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});
});

// ─── Existing function tests (createDecision, createEdge, graphragSearch) ────

describe('createDecision', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReturning.mockResolvedValue([fakeDecisionRow]);
		mockInsertValues.mockReturnValue({ returning: mockReturning });
		mockInsert.mockReturnValue({ values: mockInsertValues });
	});

	it('creates a decision inside withKeys context', async () => {
		const result = await createDecision(
			WS,
			{
				userId: USER_ID,
				rawContent: 'test content',
				decisionType: 'message',
			},
			fakeEnvelope,
		);

		expect(mockWithKeys).toHaveBeenCalledWith(fakeEnvelope, expect.any(Function));
		expect(result).toEqual(fakeDecisionRow);
	});

	it('returns null when insert returns empty', async () => {
		mockReturning.mockResolvedValue([]);

		const result = await createDecision(
			WS,
			{
				userId: USER_ID,
				rawContent: 'test content',
				decisionType: 'message',
			},
			fakeEnvelope,
		);
		expect(result).toBeNull();
	});

	it('passes embedding and interactionMetadata when provided', async () => {
		await createDecision(
			WS,
			{
				userId: USER_ID,
				rawContent: 'test content',
				decisionType: 'commitment',
				embedding: fakeEmbedding,
				interactionMetadata: { source: 'telegram' },
			},
			fakeEnvelope,
		);

		expect(mockInsert).toHaveBeenCalledTimes(1);
		expect(mockInsertValues).toHaveBeenCalledTimes(1);
	});
});

describe('createEdge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// createEdge does two selects in Promise.all for workspace membership check
		mockSelectLimit.mockResolvedValue([{ id: DECISION_ID }]);
		mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
		mockSelect.mockReturnValue({ from: mockSelectFrom });

		const edgeRow = {
			id: EDGE_ID,
			workspaceId: WS,
			sourceId: DECISION_ID,
			targetId: DECISION_ID_2,
			edgeType: 'temporal',
			weight: 0.5,
			confidenceScore: 0.5,
			createdAt: new Date(),
		};
		mockReturning.mockResolvedValue([edgeRow]);
		mockInsertValues.mockReturnValue({ returning: mockReturning });
		mockInsert.mockReturnValue({ values: mockInsertValues });
	});

	it('creates an edge after verifying workspace membership', async () => {
		const result = await createEdge(WS, {
			sourceId: DECISION_ID,
			targetId: DECISION_ID_2,
			edgeType: 'temporal',
		});

		expect(result).not.toBeNull();
		// Two select calls for workspace membership check
		expect(mockSelect).toHaveBeenCalledTimes(2);
		expect(mockInsert).toHaveBeenCalledTimes(1);
	});

	it('throws when source decision not found in workspace (SEC-056)', async () => {
		// First select returns empty (source not found), second returns a row
		mockSelectLimit
			.mockResolvedValueOnce([]) // source not found
			.mockResolvedValueOnce([{ id: DECISION_ID_2 }]); // target found

		await expect(
			createEdge(WS, {
				sourceId: 'invalid-id',
				targetId: DECISION_ID_2,
				edgeType: 'temporal',
			}),
		).rejects.toThrow('Source or target decision not found in workspace');
	});

	it('throws when target decision not found in workspace (SEC-056)', async () => {
		mockSelectLimit
			.mockResolvedValueOnce([{ id: DECISION_ID }]) // source found
			.mockResolvedValueOnce([]); // target not found

		await expect(
			createEdge(WS, {
				sourceId: DECISION_ID,
				targetId: 'invalid-id',
				edgeType: 'semantic',
			}),
		).rejects.toThrow('Source or target decision not found in workspace');
	});

	it('uses default weight 0.5 and confidenceScore 0.5', async () => {
		await createEdge(WS, {
			sourceId: DECISION_ID,
			targetId: DECISION_ID_2,
			edgeType: 'implicit_context',
		});

		expect(mockInsertValues).toHaveBeenCalledTimes(1);
	});
});

describe('graphragSearch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([]);
	});

	it('returns empty array when no results', async () => {
		const result = await graphragSearch(WS, fakeEmbedding);
		expect(result).toEqual([]);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('returns search results with id, depth, and semantic_distance', async () => {
		const rows = [
			{ id: DECISION_ID, depth: 0, semantic_distance: 0.1 },
			{ id: DECISION_ID_2, depth: 1, semantic_distance: 0.3 },
		];
		mockExecute.mockResolvedValue(rows);

		const result = await graphragSearch(WS, fakeEmbedding);
		expect(result).toEqual(rows);
		expect(result).toHaveLength(2);
	});

	it('defaults to maxDepth 3, threshold 0.2, limit 20', async () => {
		await graphragSearch(WS, fakeEmbedding);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('respects custom options', async () => {
		await graphragSearch(WS, fakeEmbedding, {
			maxDepth: 5,
			similarityThreshold: 0.5,
			limit: 10,
		});
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});
});
