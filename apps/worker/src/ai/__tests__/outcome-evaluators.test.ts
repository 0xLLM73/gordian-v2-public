import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 35 (Sprint 18) — Outcome Evaluator Tests
 *
 * Verifies all five evaluators record terminal events correctly:
 *   - evaluateDeal (deal_closed)
 *   - evaluateCommitment (commitment_fulfilled / commitment_missed)
 *   - evaluateGoal (goal_completed)
 *   - evaluateIntroduction (intro_connected)
 *   - evaluateRelationship (relationship_health)
 *
 * Key properties verified:
 *   - Correct outcome type + result for each terminal state
 *   - workspaceId always passed to createOutcome (workspace isolation)
 *   - context_labels contain NO PII (no names, emails, or raw UUIDs as values)
 *   - Idempotency: evaluateRelationship respects hasRecentOutcome 30-day cooldown
 *   - Non-terminal / not-found entities return null without writing outcomes
 */

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

// db.select().from().where().limit() chain
const mockDbLimit = vi.hoisted(() => vi.fn());
const mockDbWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockDbLimit })));
const mockDbFrom = vi.hoisted(() => vi.fn(() => ({ where: mockDbWhere })));
const mockDbSelect = vi.hoisted(() => vi.fn(() => ({ from: mockDbFrom })));
const mockDbExecute = vi.hoisted(() => vi.fn());

// DAL functions
const mockCreateOutcome = vi.hoisted(() => vi.fn());
const mockHasRecentOutcome = vi.hoisted(() => vi.fn());
const mockGetHealthScore = vi.hoisted(() => vi.fn());
const mockCreateKnowledgeNode = vi.hoisted(() => vi.fn());
const mockCreateKnowledgeLink = vi.hoisted(() => vi.fn());

// embeddings
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	db: { select: mockDbSelect, execute: mockDbExecute },
	sql: vi.fn((...args: unknown[]) => args),
	// Table schemas — used as positional args to from()/where(), mocked values unused
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
		resolution: 'resolution',
		updatedAt: 'updatedAt',
		introducerContactId: 'introducerContactId',
		id: 'id',
		workspaceId: 'workspaceId',
	},
	// Query operators — just need to not throw; results passed to mocked where()
	and: vi.fn((...args) => args),
	eq: vi.fn((field, value) => ({ field, value })),
	// DAL functions
	createOutcome: mockCreateOutcome,
	hasRecentOutcome: mockHasRecentOutcome,
	getHealthScore: mockGetHealthScore,
	createKnowledgeNode: mockCreateKnowledgeNode,
	createKnowledgeLink: mockCreateKnowledgeLink,
}));

vi.mock('../embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

// ─── Module import (dynamic — after env var is set) ───────────────────────────

process.env.FEATURE_OUTCOME_SCORING = 'true';

const {
	evaluateDeal,
	evaluateCommitment,
	evaluateGoal,
	evaluateIntroduction,
	evaluateRelationship,
	linkOutcomeToDecisionGraph,
} = await import('../outcome-evaluators');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const DEAL_ID = 'deal-00000000-0000-0000-0000-000000000001';
const COMMIT_ID = 'commit-00000000-0000-0000-0000-000000000001';
const GOAL_ID = 'goal-00000000-0000-0000-0000-000000000001';
const INTRO_ID = 'intro-00000000-0000-0000-0000-000000000001';
const CONTACT_ID = 'contact-00000000-0000-0000-0000-000000000001';

const FAKE_EMBEDDING = [0.1, 0.2, 0.3];
const FAKE_OUTCOME = { id: 'outcome-uuid', workspaceId: WS, contextLabels: [] };

// ─── evaluateDeal ─────────────────────────────────────────────────────────────

describe('evaluateDeal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbLimit.mockResolvedValue([]);
		mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
		mockCreateOutcome.mockResolvedValue(FAKE_OUTCOME);
	});

	it('returns null when deal is not found', async () => {
		mockDbLimit.mockResolvedValue([]);

		const result = await evaluateDeal(WS, DEAL_ID);

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('returns null when deal is in a non-terminal stage', async () => {
		mockDbLimit.mockResolvedValue([
			{
				stage: 'due_diligence',
				dealType: 'equity',
				value: 50_000_00, // cents
				closedAt: null,
				contactId: CONTACT_ID,
			},
		]);

		const result = await evaluateDeal(WS, DEAL_ID);

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('records a positive outcome for a won deal', async () => {
		mockDbLimit.mockResolvedValue([
			{
				stage: 'won',
				dealType: 'equity',
				value: 500_000_00, // $500k → 100k_1m
				closedAt: new Date('2026-01-15'),
				contactId: CONTACT_ID,
			},
		]);

		await evaluateDeal(WS, DEAL_ID);

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'deal_closed',
				result: 'positive',
				contactId: CONTACT_ID,
			}),
		);
	});

	it('records a negative outcome for a lost deal', async () => {
		mockDbLimit.mockResolvedValue([
			{
				stage: 'lost',
				dealType: 'venture',
				value: 1_000_00, // $1k → sub_10k
				closedAt: new Date('2026-02-01'),
				contactId: CONTACT_ID,
			},
		]);

		await evaluateDeal(WS, DEAL_ID);

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'deal_closed',
				result: 'negative',
			}),
		);
	});

	it('passes workspaceId as first arg to createOutcome (workspace isolation)', async () => {
		mockDbLimit.mockResolvedValue([
			{
				stage: 'won',
				dealType: 'equity',
				value: 10_000_00,
				closedAt: new Date(),
				contactId: null,
			},
		]);

		await evaluateDeal(WS, DEAL_ID);

		const [calledWorkspaceId] = mockCreateOutcome.mock.calls[0] as [string, unknown];
		expect(calledWorkspaceId).toBe(WS);
	});

	it('contextLabels contain no PII — only deal_type, stage, value_range keys', async () => {
		mockDbLimit.mockResolvedValue([
			{
				stage: 'won',
				dealType: 'equity',
				value: 200_000_00, // $200k → 100k_1m
				closedAt: new Date(),
				contactId: CONTACT_ID,
			},
		]);

		await evaluateDeal(WS, DEAL_ID);

		const [, outcomeData] = mockCreateOutcome.mock.calls[0] as [
			string,
			{ contextLabels: string[] },
		];
		expect(outcomeData.contextLabels).toEqual([
			'deal_type:equity',
			'stage:won',
			'value_range:100k_1m',
		]);
		// No UUIDs or raw contact identifiers
		for (const label of outcomeData.contextLabels) {
			expect(label).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/i);
		}
	});

	it('uses embedding derived from contextLabels (not raw notes)', async () => {
		mockDbLimit.mockResolvedValue([
			{
				stage: 'won',
				dealType: 'growth',
				value: 50_000_00, // $50k → 10k_100k
				closedAt: new Date(),
				contactId: null,
			},
		]);

		await evaluateDeal(WS, DEAL_ID);

		expect(mockGenerateEmbedding).toHaveBeenCalledWith(
			'deal_type:growth stage:won value_range:10k_100k',
		);
		const [, outcomeData] = mockCreateOutcome.mock.calls[0] as [string, { embedding: number[] }];
		expect(outcomeData.embedding).toEqual(FAKE_EMBEDDING);
	});
});

// ─── evaluateCommitment ───────────────────────────────────────────────────────

describe('evaluateCommitment', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbLimit.mockResolvedValue([]);
		mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
		mockCreateOutcome.mockResolvedValue(FAKE_OUTCOME);
	});

	it('returns null when commitment is not found', async () => {
		const result = await evaluateCommitment(WS, COMMIT_ID, 'fulfilled');

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('records commitment_fulfilled with positive result', async () => {
		mockDbLimit.mockResolvedValue([
			{
				commitmentType: 'promise',
				confidence: 0.9,
				assignee: 'user',
				fulfilledAt: new Date('2026-01-20'),
				contactId: CONTACT_ID,
			},
		]);

		await evaluateCommitment(WS, COMMIT_ID, 'fulfilled');

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'commitment_fulfilled',
				result: 'positive',
				contactId: CONTACT_ID,
			}),
		);
	});

	it('records commitment_missed with negative result', async () => {
		mockDbLimit.mockResolvedValue([
			{
				commitmentType: 'task',
				confidence: 0.6,
				assignee: 'contact',
				fulfilledAt: null,
				contactId: CONTACT_ID,
			},
		]);

		await evaluateCommitment(WS, COMMIT_ID, 'missed');

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'commitment_missed',
				result: 'negative',
			}),
		);
	});

	it('contextLabels contain only commitment_type, assignee, confidence — no PII', async () => {
		mockDbLimit.mockResolvedValue([
			{
				commitmentType: 'meeting',
				confidence: 0.85,
				assignee: 'user',
				fulfilledAt: new Date(),
				contactId: CONTACT_ID,
			},
		]);

		await evaluateCommitment(WS, COMMIT_ID, 'fulfilled');

		const [, outcomeData] = mockCreateOutcome.mock.calls[0] as [
			string,
			{ contextLabels: string[] },
		];
		expect(outcomeData.contextLabels).toEqual([
			'commitment_type:meeting',
			'assignee:user',
			'confidence:high', // 0.85 >= 0.85 → high
		]);
		for (const label of outcomeData.contextLabels) {
			expect(label).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/i);
		}
	});
});

// ─── evaluateGoal ─────────────────────────────────────────────────────────────

describe('evaluateGoal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbLimit.mockResolvedValue([]);
		mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
		mockCreateOutcome.mockResolvedValue(FAKE_OUTCOME);
	});

	it('returns null when goal is not found', async () => {
		const result = await evaluateGoal(WS, GOAL_ID);

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('returns null when goal is not completed', async () => {
		mockDbLimit.mockResolvedValue([
			{
				type: 'business',
				status: 'active',
				currentCount: 5,
				targetCount: 10,
				completedAt: null,
				contactId: null,
			},
		]);

		const result = await evaluateGoal(WS, GOAL_ID);

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('records positive outcome when completion is >= 90%', async () => {
		mockDbLimit.mockResolvedValue([
			{
				type: 'habit',
				status: 'completed',
				currentCount: 10,
				targetCount: 10, // 100% → positive
				completedAt: new Date('2026-02-01'),
				contactId: null,
			},
		]);

		await evaluateGoal(WS, GOAL_ID);

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'goal_completed',
				result: 'positive',
			}),
		);
	});

	it('records neutral outcome when completion is < 90%', async () => {
		mockDbLimit.mockResolvedValue([
			{
				type: 'business',
				status: 'completed',
				currentCount: 7,
				targetCount: 10, // 70% → neutral
				completedAt: new Date('2026-02-01'),
				contactId: CONTACT_ID,
			},
		]);

		await evaluateGoal(WS, GOAL_ID);

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'goal_completed',
				result: 'neutral',
			}),
		);
	});

	it('contextLabels contain goal_type and completion percentage — no PII', async () => {
		mockDbLimit.mockResolvedValue([
			{
				type: 'relationship',
				status: 'completed',
				currentCount: 9,
				targetCount: 10, // 90% → positive
				completedAt: new Date(),
				contactId: CONTACT_ID,
			},
		]);

		await evaluateGoal(WS, GOAL_ID);

		const [, outcomeData] = mockCreateOutcome.mock.calls[0] as [
			string,
			{ contextLabels: string[] },
		];
		expect(outcomeData.contextLabels).toEqual(['goal_type:relationship', 'completion:90pct']);
		for (const label of outcomeData.contextLabels) {
			expect(label).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/i);
		}
	});
});

// ─── evaluateIntroduction ─────────────────────────────────────────────────────

describe('evaluateIntroduction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbLimit.mockResolvedValue([]);
		mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
		mockCreateOutcome.mockResolvedValue(FAKE_OUTCOME);
	});

	it('returns null when introduction is not found', async () => {
		const result = await evaluateIntroduction(WS, INTRO_ID);

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('returns null when introduction is not archived', async () => {
		mockDbLimit.mockResolvedValue([
			{
				context: 'investor',
				confidence: 0.8,
				status: 'active',
				resolution: null,
				updatedAt: new Date(),
				introducerContactId: CONTACT_ID,
			},
		]);

		const result = await evaluateIntroduction(WS, INTRO_ID);

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('returns null when archived introduction is dismissed', async () => {
		mockDbLimit.mockResolvedValue([
			{
				context: 'investor',
				confidence: 0.9,
				status: 'archive',
				resolution: 'dismissed',
				updatedAt: new Date('2026-01-10'),
				introducerContactId: CONTACT_ID,
			},
		]);

		const result = await evaluateIntroduction(WS, INTRO_ID);

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('returns null when archived introduction has no completed resolution', async () => {
		mockDbLimit.mockResolvedValue([
			{
				context: 'investor',
				confidence: 0.9,
				status: 'archive',
				resolution: null,
				updatedAt: new Date('2026-01-10'),
				introducerContactId: CONTACT_ID,
			},
		]);

		const result = await evaluateIntroduction(WS, INTRO_ID);

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('records positive intro_connected outcome for archived completed introduction', async () => {
		mockDbLimit.mockResolvedValue([
			{
				context: 'investor',
				confidence: 0.9,
				status: 'archive',
				resolution: 'completed',
				updatedAt: new Date('2026-01-10'),
				introducerContactId: CONTACT_ID,
			},
		]);

		await evaluateIntroduction(WS, INTRO_ID);

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'intro_connected',
				result: 'positive',
				contactId: CONTACT_ID,
			}),
		);
	});

	it('contextLabels contain intro_context and confidence bucket — no PII', async () => {
		mockDbLimit.mockResolvedValue([
			{
				context: 'partner',
				confidence: 0.6, // medium
				status: 'archive',
				resolution: 'completed',
				updatedAt: new Date(),
				introducerContactId: CONTACT_ID,
			},
		]);

		await evaluateIntroduction(WS, INTRO_ID);

		const [, outcomeData] = mockCreateOutcome.mock.calls[0] as [
			string,
			{ contextLabels: string[] },
		];
		expect(outcomeData.contextLabels).toEqual(['intro_context:partner', 'confidence:medium']);
		for (const label of outcomeData.contextLabels) {
			expect(label).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/i);
		}
	});
});

// ─── evaluateRelationship ─────────────────────────────────────────────────────

describe('evaluateRelationship', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockHasRecentOutcome.mockResolvedValue(false);
		mockGetHealthScore.mockResolvedValue(null);
		mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
		mockCreateOutcome.mockResolvedValue(FAKE_OUTCOME);
	});

	it('returns null immediately when hasRecentOutcome is true (30-day cooldown idempotency)', async () => {
		mockHasRecentOutcome.mockResolvedValue(true);

		const result = await evaluateRelationship(WS, CONTACT_ID);

		expect(result).toBeNull();
		expect(mockGetHealthScore).not.toHaveBeenCalled();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('checks cooldown for relationship_health type with 30-day window', async () => {
		mockHasRecentOutcome.mockResolvedValue(true);

		await evaluateRelationship(WS, CONTACT_ID);

		expect(mockHasRecentOutcome).toHaveBeenCalledWith(WS, CONTACT_ID, 'relationship_health', 30);
	});

	it('returns null when no health score exists for the contact', async () => {
		mockHasRecentOutcome.mockResolvedValue(false);
		mockGetHealthScore.mockResolvedValue(null);

		const result = await evaluateRelationship(WS, CONTACT_ID);

		expect(result).toBeNull();
		expect(mockCreateOutcome).not.toHaveBeenCalled();
	});

	it('maps improving trend to positive result', async () => {
		mockGetHealthScore.mockResolvedValue({ trend: 'improving', label: 'thriving', composite: 85 });

		await evaluateRelationship(WS, CONTACT_ID);

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'relationship_health',
				result: 'positive',
				contactId: CONTACT_ID,
			}),
		);
	});

	it('maps declining trend to negative result', async () => {
		mockGetHealthScore.mockResolvedValue({ trend: 'declining', label: 'cooling', composite: 30 });

		await evaluateRelationship(WS, CONTACT_ID);

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'relationship_health',
				result: 'negative',
			}),
		);
	});

	it('maps stable trend to neutral result', async () => {
		mockGetHealthScore.mockResolvedValue({ trend: 'stable', label: 'healthy', composite: 60 });

		await evaluateRelationship(WS, CONTACT_ID);

		expect(mockCreateOutcome).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'relationship_health',
				result: 'neutral',
			}),
		);
	});

	it('contextLabels contain trend and label — no PII', async () => {
		mockGetHealthScore.mockResolvedValue({ trend: 'improving', label: 'thriving', composite: 90 });

		await evaluateRelationship(WS, CONTACT_ID);

		const [, outcomeData] = mockCreateOutcome.mock.calls[0] as [
			string,
			{ contextLabels: string[] },
		];
		expect(outcomeData.contextLabels).toEqual(['trend:improving', 'label:thriving']);
		for (const label of outcomeData.contextLabels) {
			expect(label).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/i);
		}
	});
});

// ─── linkOutcomeToDecisionGraph ──────────────────────────────────────────────

const OUTCOME_NODE = { id: 'outcome-node-uuid', workspaceId: WS, type: 'outcome' };
const DECISION_NODE_ID = 'decision-node-uuid';
const RATIONALE_NODE_ID = 'rationale-node-uuid';

describe('linkOutcomeToDecisionGraph', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// resolveWorkspaceEnvelope uses db.select().from().where().limit()
		mockDbLimit.mockResolvedValue([
			{
				encryptedWrk: Buffer.from('test-wrk').toString('base64'),
				kmsContext: '{}',
				wrkVersion: 1,
			},
		]);
		mockCreateKnowledgeNode.mockResolvedValue(OUTCOME_NODE);
		mockCreateKnowledgeLink.mockResolvedValue({});
		mockDbExecute.mockResolvedValue([]);
	});

	it('returns early without creating nodes when entityId is undefined', async () => {
		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			undefined,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockCreateKnowledgeNode).not.toHaveBeenCalled();
		expect(mockCreateKnowledgeLink).not.toHaveBeenCalled();
	});

	it('creates an outcome node with roi_weight 1.3 for positive results', async () => {
		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockCreateKnowledgeNode).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: 'outcome',
				embedding: FAKE_EMBEDDING,
				metadata: expect.objectContaining({
					result: 'positive',
					roi_weight: 1.3,
					entityId: DEAL_ID,
					entityType: 'deal',
				}),
			}),
			expect.objectContaining({ wrkVersion: 1 }),
		);
	});

	it('creates an outcome node with roi_weight 0.5 for negative results', async () => {
		await linkOutcomeToDecisionGraph(
			WS,
			'negative',
			DEAL_ID,
			'deal',
			['stage:lost'],
			FAKE_EMBEDDING,
		);

		const [, nodeData] = mockCreateKnowledgeNode.mock.calls[0] as [
			string,
			{ metadata: { roi_weight: number } },
		];
		expect(nodeData.metadata.roi_weight).toBe(0.5);
	});

	it('creates an outcome node with roi_weight 1.0 for neutral results', async () => {
		await linkOutcomeToDecisionGraph(
			WS,
			'neutral',
			GOAL_ID,
			'goal',
			['completion:70pct'],
			FAKE_EMBEDDING,
		);

		const [, nodeData] = mockCreateKnowledgeNode.mock.calls[0] as [
			string,
			{ metadata: { roi_weight: number } },
		];
		expect(nodeData.metadata.roi_weight).toBe(1.0);
	});

	it('returns early without creating links when no decision node found', async () => {
		mockDbExecute.mockResolvedValue([]); // No decision node

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockCreateKnowledgeNode).toHaveBeenCalled(); // outcome node still created
		expect(mockCreateKnowledgeLink).not.toHaveBeenCalled(); // no link created
	});

	it('creates led_to link from decision to outcome when decision node exists', async () => {
		// First execute: find decision node
		mockDbExecute.mockResolvedValueOnce([{ id: DECISION_NODE_ID }]);
		// Second execute: find cited rationales
		mockDbExecute.mockResolvedValueOnce([]);

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		expect(mockCreateKnowledgeLink).toHaveBeenCalledWith(
			WS,
			DECISION_NODE_ID,
			OUTCOME_NODE.id,
			'led_to',
			1.3,
		);
	});

	it('computes rolling average roi_weight on cited rationale nodes', async () => {
		// First execute: find decision node
		mockDbExecute.mockResolvedValueOnce([{ id: DECISION_NODE_ID }]);
		// Second execute: find cited rationales
		mockDbExecute.mockResolvedValueOnce([{ target_node_id: RATIONALE_NODE_ID }]);
		// Third execute: find all outcomes linked via rationale → avg roi_weight
		mockDbExecute.mockResolvedValueOnce([{ roi_weight: '1.3' }, { roi_weight: '0.5' }]);
		// Fourth execute: UPDATE knowledge_nodes SET metadata
		mockDbExecute.mockResolvedValueOnce([]);

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		// Should have 4 db.execute calls: find decision, find rationales, find outcomes, update rationale
		expect(mockDbExecute).toHaveBeenCalledTimes(4);
	});

	it('uses structural displayName format — no PII (SEC-PROV-009)', async () => {
		await linkOutcomeToDecisionGraph(
			WS,
			'negative',
			COMMIT_ID,
			'commitment',
			['assignee:user'],
			FAKE_EMBEDDING,
		);

		const [, nodeData] = mockCreateKnowledgeNode.mock.calls[0] as [
			string,
			{ displayName: string; name: string },
		];
		expect(nodeData.displayName).toBe('commitment \u2192 negative');
		expect(nodeData.name).toBe(`outcome:commitment:${COMMIT_ID}`.toLowerCase());
	});

	it('includes workspace_id in all SQL queries (SEC-PROV-008)', async () => {
		// First execute: find decision node
		mockDbExecute.mockResolvedValueOnce([{ id: DECISION_NODE_ID }]);
		// Second execute: find cited rationales
		mockDbExecute.mockResolvedValueOnce([{ target_node_id: RATIONALE_NODE_ID }]);
		// Third execute: find all outcomes
		mockDbExecute.mockResolvedValueOnce([{ roi_weight: '1.0' }]);
		// Fourth execute: update
		mockDbExecute.mockResolvedValueOnce([]);

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		// Verify workspace_id is passed to all 4 execute calls
		for (const call of mockDbExecute.mock.calls) {
			const sqlStr = JSON.stringify(call[0]);
			expect(sqlStr).toContain(WS);
		}
	});

	it('skips rationale update when no weights are parseable', async () => {
		mockDbExecute.mockResolvedValueOnce([{ id: DECISION_NODE_ID }]);
		mockDbExecute.mockResolvedValueOnce([{ target_node_id: RATIONALE_NODE_ID }]);
		// Outcomes with unparseable roi_weight
		mockDbExecute.mockResolvedValueOnce([{ roi_weight: null }, { roi_weight: 'bad' }]);

		await linkOutcomeToDecisionGraph(
			WS,
			'positive',
			DEAL_ID,
			'deal',
			['stage:won'],
			FAKE_EMBEDDING,
		);

		// Should only have 3 execute calls — no UPDATE because weights are all NaN
		expect(mockDbExecute).toHaveBeenCalledTimes(3);
	});
});
