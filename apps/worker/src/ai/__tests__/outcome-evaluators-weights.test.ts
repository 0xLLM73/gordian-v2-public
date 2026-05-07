import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CGC Phase 4a: Outcome-Based Edge Weight Updates
 *
 * Tests the CGC addition to linkOutcomeToDecisionGraph:
 * - +0.1 weight for positive outcomes (cap 1.0)
 * - -0.1 weight for negative outcomes (floor 0.1)
 * - 0 weight change for neutral outcomes
 * - implicit_context edge creation with outcome-based weights
 */

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockDbLimit = vi.hoisted(() => vi.fn());
const mockDbWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockDbLimit })));
const mockDbFrom = vi.hoisted(() => vi.fn(() => ({ where: mockDbWhere })));
const mockDbSelect = vi.hoisted(() => vi.fn(() => ({ from: mockDbFrom })));
const mockDbExecute = vi.hoisted(() => vi.fn());

const mockCreateOutcome = vi.hoisted(() => vi.fn());
const mockHasRecentOutcome = vi.hoisted(() => vi.fn());
const mockGetHealthScore = vi.hoisted(() => vi.fn());
const mockCreateKnowledgeNode = vi.hoisted(() => vi.fn());
const mockCreateKnowledgeLink = vi.hoisted(() => vi.fn());
const mockFindDecisionByEntityId = vi.hoisted(() => vi.fn());
const mockFindEdgesByTargetDecision = vi.hoisted(() => vi.fn());
const mockUpdateEdgeWeight = vi.hoisted(() => vi.fn());
const mockCreateEdge = vi.hoisted(() => vi.fn());

const mockGenerateEmbedding = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	db: { select: mockDbSelect, execute: mockDbExecute },
	sql: vi.fn((...args: unknown[]) => args),
	workspaces: {
		id: 'id',
		encryptedWrk: 'encrypted_wrk',
		kmsContext: 'kms_context',
		wrkVersion: 'wrk_version',
	},
	deals: {
		stage: 'stage',
		dealType: 'dealType',
		value: 'value',
		closedAt: 'closedAt',
		contactId: 'contactId',
		id: 'id',
		workspaceId: 'workspaceId',
	},
	commitments: {
		commitmentType: 'commitmentType',
		confidence: 'confidence',
		assignee: 'assignee',
		fulfilledAt: 'fulfilledAt',
		contactId: 'contactId',
		id: 'id',
		workspaceId: 'workspaceId',
	},
	goals: {
		type: 'type',
		status: 'status',
		currentCount: 'currentCount',
		targetCount: 'targetCount',
		completedAt: 'completedAt',
		contactId: 'contactId',
		id: 'id',
		workspaceId: 'workspaceId',
	},
	introductions: {
		context: 'context',
		confidence: 'confidence',
		status: 'status',
		updatedAt: 'updatedAt',
		introducerContactId: 'introducerContactId',
		id: 'id',
		workspaceId: 'workspaceId',
	},
	and: vi.fn((...args) => args),
	eq: vi.fn((field, value) => ({ field, value })),
	createOutcome: mockCreateOutcome,
	hasRecentOutcome: mockHasRecentOutcome,
	getHealthScore: mockGetHealthScore,
	createKnowledgeNode: mockCreateKnowledgeNode,
	createKnowledgeLink: mockCreateKnowledgeLink,
	findDecisionByEntityId: mockFindDecisionByEntityId,
	findEdgesByTargetDecision: mockFindEdgesByTargetDecision,
	updateEdgeWeight: mockUpdateEdgeWeight,
	createEdge: mockCreateEdge,
}));

vi.mock('../embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

// ─── Module import ────────────────────────────────────────────────────────────

process.env.FEATURE_OUTCOME_SCORING = 'true';

const { linkOutcomeToDecisionGraph } = await import('../outcome-evaluators');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const DEAL_ID = 'deal-00000000-0000-0000-0000-000000000001';
const DECISION_ID = 'dec-00000000-0000-0000-0000-000000000001';
const EDGE_ID_1 = 'edge-00000000-0000-0000-0000-000000000001';
const EDGE_ID_2 = 'edge-00000000-0000-0000-0000-000000000002';
const SOURCE_ID_1 = 'src-00000000-0000-0000-0000-000000000001';
const SOURCE_ID_2 = 'src-00000000-0000-0000-0000-000000000002';
const FAKE_EMBEDDING = Array(512).fill(0.1);

const OUTCOME_NODE = { id: 'outcome-node-uuid', workspaceId: WS, type: 'outcome' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CGC Phase 4a: edge weight updates in linkOutcomeToDecisionGraph', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// resolveWorkspaceEnvelope
		mockDbLimit.mockResolvedValue([
			{
				encryptedWrk: Buffer.from('test-wrk').toString('base64'),
				kmsContext: '{}',
				wrkVersion: 1,
			},
		]);
		mockCreateKnowledgeNode.mockResolvedValue(OUTCOME_NODE);
		mockCreateKnowledgeLink.mockResolvedValue({});
		// Default: decision node found, but no rationales and no CGC decision
		mockDbExecute.mockResolvedValue([]);
		mockFindDecisionByEntityId.mockResolvedValue(null);
		mockFindEdgesByTargetDecision.mockResolvedValue([]);
		mockUpdateEdgeWeight.mockResolvedValue(undefined);
		mockCreateEdge.mockResolvedValue({});
	});

	// Helper: set up db.execute to pass through knowledge graph path
	// Step 1: find decision node in knowledge graph → return a node ID
	// Step 2: find cited rationales → return empty (no rationales)
	function setupKnowledgeGraphPath() {
		mockDbExecute.mockResolvedValueOnce([{ id: 'kg-decision-node' }]); // find decision node
		mockDbExecute.mockResolvedValueOnce([]); // no cited rationales
	}

	it('calls findDecisionByEntityId with workspace and entity', async () => {
		setupKnowledgeGraphPath();

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockFindDecisionByEntityId).toHaveBeenCalledWith(WS, DEAL_ID);
	});

	it('applies +0.1 weight delta for positive outcomes', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue({ id: DECISION_ID });
		mockFindEdgesByTargetDecision.mockResolvedValue([
			{ id: EDGE_ID_1, weight: 0.5, sourceId: SOURCE_ID_1 },
		]);

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockUpdateEdgeWeight).toHaveBeenCalledWith(WS, EDGE_ID_1, 0.1);
	});

	it('applies -0.1 weight delta for negative outcomes', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue({ id: DECISION_ID });
		mockFindEdgesByTargetDecision.mockResolvedValue([
			{ id: EDGE_ID_1, weight: 0.5, sourceId: SOURCE_ID_1 },
		]);

		await linkOutcomeToDecisionGraph(
			WS,
			'negative',
			DEAL_ID,
			'deal',
			['stage:lost'],
			FAKE_EMBEDDING,
		);

		expect(mockUpdateEdgeWeight).toHaveBeenCalledWith(WS, EDGE_ID_1, -0.1);
	});

	it('does not update weight for neutral outcomes', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue({ id: DECISION_ID });
		mockFindEdgesByTargetDecision.mockResolvedValue([
			{ id: EDGE_ID_1, weight: 0.5, sourceId: SOURCE_ID_1 },
		]);

		await linkOutcomeToDecisionGraph(
			WS,
			'neutral',
			DEAL_ID,
			'deal',
			['stage:active'],
			FAKE_EMBEDDING,
		);

		expect(mockUpdateEdgeWeight).not.toHaveBeenCalled();
	});

	it('updates all edges pointing to the decision', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue({ id: DECISION_ID });
		mockFindEdgesByTargetDecision.mockResolvedValue([
			{ id: EDGE_ID_1, weight: 0.5, sourceId: SOURCE_ID_1 },
			{ id: EDGE_ID_2, weight: 0.7, sourceId: SOURCE_ID_2 },
		]);

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockUpdateEdgeWeight).toHaveBeenCalledTimes(2);
		expect(mockUpdateEdgeWeight).toHaveBeenCalledWith(WS, EDGE_ID_1, 0.1);
		expect(mockUpdateEdgeWeight).toHaveBeenCalledWith(WS, EDGE_ID_2, 0.1);
	});

	it('creates implicit_context edges with weight 0.7 for positive outcomes', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue({ id: DECISION_ID });
		mockFindEdgesByTargetDecision.mockResolvedValue([
			{ id: EDGE_ID_1, weight: 0.5, sourceId: SOURCE_ID_1 },
		]);

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockCreateEdge).toHaveBeenCalledWith(WS, {
			sourceId: SOURCE_ID_1,
			targetId: DECISION_ID,
			edgeType: 'implicit_context',
			weight: 0.7,
			confidenceScore: 0.8,
		});
	});

	it('creates implicit_context edges with weight 0.3 for negative outcomes', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue({ id: DECISION_ID });
		mockFindEdgesByTargetDecision.mockResolvedValue([
			{ id: EDGE_ID_1, weight: 0.5, sourceId: SOURCE_ID_1 },
		]);

		await linkOutcomeToDecisionGraph(
			WS,
			'negative',
			DEAL_ID,
			'deal',
			['stage:lost'],
			FAKE_EMBEDDING,
		);

		expect(mockCreateEdge).toHaveBeenCalledWith(WS, {
			sourceId: SOURCE_ID_1,
			targetId: DECISION_ID,
			edgeType: 'implicit_context',
			weight: 0.3,
			confidenceScore: 0.8,
		});
	});

	it('creates implicit_context edges with weight 0.5 for neutral outcomes', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue({ id: DECISION_ID });
		mockFindEdgesByTargetDecision.mockResolvedValue([
			{ id: EDGE_ID_1, weight: 0.5, sourceId: SOURCE_ID_1 },
		]);

		await linkOutcomeToDecisionGraph(
			WS,
			'neutral',
			DEAL_ID,
			'deal',
			['stage:active'],
			FAKE_EMBEDDING,
		);

		expect(mockCreateEdge).toHaveBeenCalledWith(WS, {
			sourceId: SOURCE_ID_1,
			targetId: DECISION_ID,
			edgeType: 'implicit_context',
			weight: 0.5,
			confidenceScore: 0.8,
		});
	});

	it('skips edge updates when no decision found for entityId', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue(null);

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockFindEdgesByTargetDecision).not.toHaveBeenCalled();
		expect(mockUpdateEdgeWeight).not.toHaveBeenCalled();
	});

	it('skips edge updates when no edges point to the decision', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue({ id: DECISION_ID });
		mockFindEdgesByTargetDecision.mockResolvedValue([]);

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockUpdateEdgeWeight).not.toHaveBeenCalled();
		expect(mockCreateEdge).not.toHaveBeenCalled();
	});

	it('handles CGC edge update errors gracefully (non-fatal)', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockRejectedValue(new Error('DB error'));

		// Should not throw — wrapped in try/catch
		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockCreateKnowledgeNode).toHaveBeenCalled(); // outcome node still created
	});

	it('handles duplicate implicit_context edge gracefully', async () => {
		setupKnowledgeGraphPath();
		mockFindDecisionByEntityId.mockResolvedValue({ id: DECISION_ID });
		mockFindEdgesByTargetDecision.mockResolvedValue([
			{ id: EDGE_ID_1, weight: 0.5, sourceId: SOURCE_ID_1 },
		]);
		mockCreateEdge.mockRejectedValue(new Error('Duplicate edge'));

		// Should not throw
		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);
	});
});
