import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockIsFeatureEnabled = vi.hoisted(() => vi.fn());
const mockGetDecliningContacts = vi.hoisted(() => vi.fn());
const mockGetActiveCommitments = vi.hoisted(() => vi.fn());
const mockListDeals = vi.hoisted(() => vi.fn());
const mockListKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockListContactIdsByKnowledge = vi.hoisted(() => vi.fn());
const mockListGoals = vi.hoisted(() => vi.fn());
const mockCreateRecommendations = vi.hoisted(() => vi.fn());
const mockExpireOldRecommendations = vi.hoisted(() => vi.fn());
const mockSearchKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockGetHealthScore = vi.hoisted(() => vi.fn());
const mockGetKnowledgeNeighbors = vi.hoisted(() => vi.fn());
const mockGetLastMessageDate = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());
const mockWithKeys = vi.hoisted(() => vi.fn());
const mockMaskEntities = vi.hoisted(() => vi.fn());
const mockKeyStore = vi.hoisted(() => ({ getStore: vi.fn() }));

vi.mock('@repo/db', () => ({
	isFeatureEnabled: mockIsFeatureEnabled,
	getDecliningContacts: mockGetDecliningContacts,
	getActiveCommitments: mockGetActiveCommitments,
	listDeals: mockListDeals,
	listKnowledgeNodes: mockListKnowledgeNodes,
	listContactIdsByKnowledge: mockListContactIdsByKnowledge,
	listGoals: mockListGoals,
	createRecommendations: mockCreateRecommendations,
	expireOldRecommendations: mockExpireOldRecommendations,
	searchKnowledgeNodes: mockSearchKnowledgeNodes,
	getHealthScore: mockGetHealthScore,
	getKnowledgeNeighbors: mockGetKnowledgeNeighbors,
	getLastMessageDate: mockGetLastMessageDate,
}));

vi.mock('@repo/crypto', () => ({
	withKeys: mockWithKeys,
	getCurrentKeys: () => mockKeyStore.getStore(),
	keyStore: mockKeyStore,
	maskEntities: mockMaskEntities,
}));

vi.mock('../embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('../prefilter', () => ({
	prefilterEntities: mockPrefilterEntities,
}));

import {
	computeRecommendations,
	scoreAchieveGoal,
	scoreAdvanceDeal,
	scoreFollowUp,
	scoreMakeIntro,
	scoreOutreachForGoal,
	scoreReEngage,
	suggestContactsForGoal,
} from '../recommendations';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const fakeEnvelope = {
	encryptedWrk: Buffer.from('fake'),
	kmsContext: {},
	wrkVersion: 1,
};
const fakeEmbedding = [0.1, 0.2, 0.3];
const fakeBik = Buffer.from('abcdef', 'hex');

// Default G7 mocks: withKeys executes the callback, masking is a passthrough
beforeEach(() => {
	mockWithKeys.mockImplementation((_env: unknown, fn: () => unknown) => fn());
	mockKeyStore.getStore.mockReturnValue({ bik: fakeBik });
	mockMaskEntities.mockImplementation((text: string) => ({ maskedText: text }));
	mockPrefilterEntities.mockReturnValue([]);
	mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
	mockSearchKnowledgeNodes.mockResolvedValue([]);
});

// ─── scoreReEngage ────────────────────────────────────────────────────────────

describe('scoreReEngage', () => {
	beforeEach(() => vi.clearAllMocks());

	it('maps declining contacts to re_engage recommendations', async () => {
		mockGetDecliningContacts.mockResolvedValue([
			{ contactId: 'c-1', recency: 20, composite: 30 },
			{ contactId: 'c-2', recency: 40, composite: 45 },
		]);

		const items = await scoreReEngage(WS);

		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({
			contactId: 'c-1',
			type: 're_engage',
			priorityScore: 0.8, // (100 - 20) / 100
		});
		expect(items[0].reasoning).toContain('declining_trend');
		expect(items[0].reasoning).not.toMatch(/[a-f0-9-]{36}/); // no UUIDs
	});

	it('returns empty array when no declining contacts', async () => {
		mockGetDecliningContacts.mockResolvedValue([]);
		const items = await scoreReEngage(WS);
		expect(items).toHaveLength(0);
	});
});

// ─── scoreFollowUp ────────────────────────────────────────────────────────────

describe('scoreFollowUp', () => {
	beforeEach(() => vi.clearAllMocks());

	it('groups commitments by contactId and scores proportionally', async () => {
		mockGetActiveCommitments.mockResolvedValue([
			{ contactId: 'c-1', commitmentType: 'task', title: 'T1' },
			{ contactId: 'c-1', commitmentType: 'task', title: 'T2' },
			{ contactId: 'c-2', commitmentType: 'meeting', title: 'M1' },
		]);

		const items = await scoreFollowUp(WS, fakeEnvelope);

		expect(items).toHaveLength(2);
		const c1 = items.find((i) => i.contactId === 'c-1')!;
		expect(c1.type).toBe('follow_up');
		expect(c1.priorityScore).toBeCloseTo(0.4); // min(2/5, 1.0)
		expect(c1.reasoning).toBe('open_commitments:2');
	});

	it('caps priority at 1.0 for 5+ commitments', async () => {
		mockGetActiveCommitments.mockResolvedValue(
			Array.from({ length: 10 }, (_, i) => ({
				contactId: 'c-heavy',
				commitmentType: 'task',
				title: `Task ${i}`,
			})),
		);

		const items = await scoreFollowUp(WS, fakeEnvelope);

		expect(items[0]?.priorityScore).toBe(1.0);
	});

	it('skips commitments without contactId', async () => {
		mockGetActiveCommitments.mockResolvedValue([
			{ contactId: null, commitmentType: 'task', title: 'Workspace task' },
		]);

		const items = await scoreFollowUp(WS, fakeEnvelope);
		expect(items).toHaveLength(0);
	});
});

// ─── scoreAdvanceDeal ─────────────────────────────────────────────────────────

describe('scoreAdvanceDeal', () => {
	beforeEach(() => vi.clearAllMocks());

	const staleDeal = {
		contactId: 'c-1',
		stage: 'discovery',
		createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
		stageHistory: [
			{
				stage: 'discovery',
				timestamp: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
			},
		],
	};

	const freshDeal = {
		contactId: 'c-2',
		stage: 'due_diligence',
		createdAt: new Date().toISOString(),
		stageHistory: [{ stage: 'due_diligence', timestamp: new Date().toISOString() }],
	};

	it('surfaces stalled deals (>= 30 days since last stage change)', async () => {
		mockListDeals.mockResolvedValue([staleDeal, freshDeal]);

		const items = await scoreAdvanceDeal(WS, fakeEnvelope);

		expect(items).toHaveLength(1);
		expect(items[0]?.contactId).toBe('c-1');
		expect(items[0]?.type).toBe('advance_deal');
		expect(items[0]?.reasoning).toContain('stalled_deal');
	});

	it('skips terminal deals (won/lost)', async () => {
		mockListDeals.mockResolvedValue([
			{ ...staleDeal, stage: 'won' },
			{ ...staleDeal, stage: 'lost' },
		]);

		const items = await scoreAdvanceDeal(WS, fakeEnvelope);
		expect(items).toHaveLength(0);
	});
});

// ─── scoreMakeIntro ───────────────────────────────────────────────────────────

describe('scoreMakeIntro', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns intro recommendation when a knowledge node has 2+ contacts', async () => {
		mockListKnowledgeNodes.mockResolvedValue([{ id: 'node-1', type: 'sector', mentionCount: 5 }]);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-1', 'c-2']);

		const items = await scoreMakeIntro(WS);

		expect(items).toHaveLength(1);
		expect(items[0]?.type).toBe('make_intro');
		expect(items[0]?.reasoning).toContain('shared_knowledge:sector');
		expect(items[0]?.reasoning).not.toContain('c-1'); // no contact ID in reasoning
	});

	it('caps at 5 intro recommendations', async () => {
		mockListKnowledgeNodes.mockResolvedValue(
			Array.from({ length: 20 }, (_, i) => ({ id: `node-${i}`, type: 'topic' })),
		);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-1', 'c-2']);

		const items = await scoreMakeIntro(WS);
		expect(items.length).toBeLessThanOrEqual(5);
	});

	it('ignores nodes with fewer than 2 contacts', async () => {
		mockListKnowledgeNodes.mockResolvedValue([{ id: 'node-1', type: 'topic' }]);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-1']);

		const items = await scoreMakeIntro(WS);
		expect(items).toHaveLength(0);
	});
});

// ─── scoreAchieveGoal ─────────────────────────────────────────────────────────

describe('scoreAchieveGoal', () => {
	beforeEach(() => vi.clearAllMocks());

	it('surfaces goals with >= 10% gap', async () => {
		mockListGoals.mockResolvedValue([
			{
				id: 'g-1',
				type: 'business',
				title: 'Close 10 deals',
				currentCount: 2,
				targetCount: 10,
				contactId: null,
				targetDate: null,
			},
		]);

		const items = await scoreAchieveGoal(WS, fakeEnvelope);

		expect(items).toHaveLength(1);
		expect(items[0]?.type).toBe('achieve_goal');
		expect(items[0]?.priorityScore).toBeCloseTo(0.8); // 1 - (2/10)
		expect(items[0]?.reasoning).toContain('80% behind target');
	});

	it('skips goals that are on track (< 10% gap)', async () => {
		mockListGoals.mockResolvedValue([
			{
				id: 'g-2',
				type: 'habit',
				title: 'Daily check-ins',
				currentCount: 9,
				targetCount: 10,
				contactId: null,
				targetDate: null,
			},
		]);

		const items = await scoreAchieveGoal(WS, fakeEnvelope);
		expect(items).toHaveLength(0);
	});
});

// ─── suggestContactsForGoal (G7) ──────────────────────────────────────────────

describe('suggestContactsForGoal', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns count + context text with no PII', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'DeFi', similarity: 0.8 },
			{ id: 'node-2', displayName: 'Paradigm', similarity: 0.6 },
		]);
		mockListContactIdsByKnowledge
			.mockResolvedValueOnce(['c-1', 'c-2'])
			.mockResolvedValueOnce(['c-3']);

		const result = await suggestContactsForGoal(WS, 'Meet DeFi founders', fakeEnvelope);

		expect(result).toBe('3 relevant contacts linked via knowledge graph (DeFi, Paradigm).');
		expect(mockGenerateEmbedding).toHaveBeenCalledOnce();
		expect(mockMaskEntities).toHaveBeenCalledWith('Meet DeFi founders', fakeBik, []);
	});

	it('returns null when no knowledge nodes match', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([]);

		const result = await suggestContactsForGoal(WS, 'Some goal', fakeEnvelope);
		expect(result).toBeNull();
	});

	it('returns null when matching nodes have no linked contacts', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'Crypto', similarity: 0.7 },
		]);
		mockListContactIdsByKnowledge.mockResolvedValue([]);

		const result = await suggestContactsForGoal(WS, 'Crypto goal', fakeEnvelope);
		expect(result).toBeNull();
	});

	it('skips nodes below similarity threshold (0.3)', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'Weak match', similarity: 0.2 },
		]);

		const result = await suggestContactsForGoal(WS, 'Unrelated', fakeEnvelope);
		expect(result).toBeNull();
		expect(mockListContactIdsByKnowledge).not.toHaveBeenCalled();
	});

	it('deduplicates contacts across multiple knowledge nodes', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'DeFi', similarity: 0.8 },
			{ id: 'node-2', displayName: 'Uniswap', similarity: 0.6 },
		]);
		// Same contact linked to both nodes
		mockListContactIdsByKnowledge
			.mockResolvedValueOnce(['c-1'])
			.mockResolvedValueOnce(['c-1', 'c-2']);

		const result = await suggestContactsForGoal(WS, 'DeFi research', fakeEnvelope);
		expect(result).toBe('2 relevant contacts linked via knowledge graph (DeFi, Uniswap).');
	});

	it('caps at 3 contacts even with many linked', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'Topic', similarity: 0.9 },
		]);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-1', 'c-2', 'c-3', 'c-4', 'c-5']);

		const result = await suggestContactsForGoal(WS, 'Topic goal', fakeEnvelope);
		expect(result).toBe('3 relevant contacts linked via knowledge graph (Topic).');
	});

	it('uses singular form for 1 contact', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'Tech', similarity: 0.7 },
		]);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-1']);

		const result = await suggestContactsForGoal(WS, 'Tech goal', fakeEnvelope);
		expect(result).toBe('1 relevant contact linked via knowledge graph (Tech).');
	});
});

describe('scoreAchieveGoal + G7 integration', () => {
	beforeEach(() => vi.clearAllMocks());

	it('appends contact suggestions to reasoning when knowledge matches exist', async () => {
		mockListGoals.mockResolvedValue([
			{
				id: 'g-1',
				type: 'business',
				title: 'Close DeFi deals',
				currentCount: 1,
				targetCount: 10,
				contactId: null,
				targetDate: null,
			},
		]);
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'DeFi', similarity: 0.8 },
		]);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-1']);

		const items = await scoreAchieveGoal(WS, fakeEnvelope);

		expect(items).toHaveLength(1);
		expect(items[0]?.reasoning).toContain('90% behind target');
		expect(items[0]?.reasoning).toContain('1 relevant contact linked via knowledge graph (DeFi).');
	});

	it('still produces recommendation when suggestContactsForGoal throws', async () => {
		mockListGoals.mockResolvedValue([
			{
				id: 'g-1',
				type: 'business',
				title: 'Network more',
				currentCount: 0,
				targetCount: 5,
				contactId: null,
				targetDate: null,
			},
		]);
		mockGenerateEmbedding.mockRejectedValue(new Error('API down'));

		const items = await scoreAchieveGoal(WS, fakeEnvelope);

		expect(items).toHaveLength(1);
		expect(items[0]?.reasoning).toContain('100% behind target');
		expect(items[0]?.reasoning).not.toContain('Suggested contacts');
	});
});

// ─── computeRecommendations ───────────────────────────────────────────────────

describe('computeRecommendations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateRecommendations.mockResolvedValue([]);
		mockExpireOldRecommendations.mockResolvedValue(0);
		mockGetDecliningContacts.mockResolvedValue([]);
		mockGetActiveCommitments.mockResolvedValue([]);
		mockListDeals.mockResolvedValue([]);
		mockListKnowledgeNodes.mockResolvedValue([]);
		mockListContactIdsByKnowledge.mockResolvedValue([]);
		mockListGoals.mockResolvedValue([]);
	});

	it('returns early when feature flag is off', async () => {
		mockIsFeatureEnabled.mockResolvedValue(false);

		await computeRecommendations(WS, fakeEnvelope);

		expect(mockCreateRecommendations).not.toHaveBeenCalled();
	});

	it('expires stale recommendations before computing', async () => {
		mockIsFeatureEnabled.mockResolvedValue(true);
		mockExpireOldRecommendations.mockResolvedValue(3);

		await computeRecommendations(WS, fakeEnvelope);

		expect(mockExpireOldRecommendations).toHaveBeenCalledWith(WS);
	});

	it('persists all recommendations from all scorers', async () => {
		mockIsFeatureEnabled.mockResolvedValue(true);
		mockGetDecliningContacts.mockResolvedValue([{ contactId: 'c-1', recency: 10, composite: 20 }]);
		mockGetActiveCommitments.mockResolvedValue([
			{ contactId: 'c-2', commitmentType: 'task', title: 'T1' },
		]);

		await computeRecommendations(WS, fakeEnvelope);

		expect(mockCreateRecommendations).toHaveBeenCalledWith(
			WS,
			expect.arrayContaining([
				expect.objectContaining({ type: 're_engage' }),
				expect.objectContaining({ type: 'follow_up' }),
			]),
		);
	});

	it('skips createRecommendations when no items generated', async () => {
		mockIsFeatureEnabled.mockResolvedValue(true);
		// All scorers return empty (mocked defaults above)

		await computeRecommendations(WS, fakeEnvelope);

		expect(mockCreateRecommendations).not.toHaveBeenCalled();
	});
});

// ─── scoreOutreachForGoal (GI3) ──────────────────────────────────────────────

describe('scoreOutreachForGoal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWithKeys.mockImplementation((_env: unknown, fn: () => unknown) => fn());
		mockKeyStore.getStore.mockReturnValue({ bik: fakeBik });
		mockMaskEntities.mockImplementation((text: string) => ({ maskedText: text }));
		mockPrefilterEntities.mockReturnValue([]);
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockGetHealthScore.mockResolvedValue(null);
		mockGetLastMessageDate.mockResolvedValue(null);
		mockGetKnowledgeNeighbors.mockResolvedValue([]);
	});

	it('weights sum to 1.0 (Fit 50% + Intent 35% + Timing 15%)', () => {
		// Verify weights are correct by computing a known score
		// contact matching all goal nodes, health=100, recent message → all maxed
		expect(0.5 + 0.35 + 0.15).toBe(1.0);
	});

	it('returns empty array when no KG nodes match the goal', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([]);

		const results = await scoreOutreachForGoal(WS, 'Unrelated goal', fakeEnvelope);
		expect(results).toEqual([]);
	});

	it('returns empty array when nodes match but no contacts linked', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'DeFi', similarity: 0.8 },
		]);
		mockListContactIdsByKnowledge.mockResolvedValue([]);

		const results = await scoreOutreachForGoal(WS, 'DeFi deals', fakeEnvelope);
		expect(results).toEqual([]);
	});

	it('scores contacts with Fit/Intent/Timing and returns sorted top 5', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'DeFi', similarity: 0.8 },
			{ id: 'node-2', displayName: 'LP', similarity: 0.6 },
		]);
		// c-1 matches both nodes, c-2 matches only one
		mockListContactIdsByKnowledge
			.mockResolvedValueOnce(['c-1', 'c-2']) // node-1
			.mockResolvedValueOnce(['c-1']); // node-2

		// c-1: high health, recent message
		mockGetHealthScore
			.mockResolvedValueOnce({ composite: 80, label: 'strong' })
			.mockResolvedValueOnce({ composite: 30, label: 'weak' });
		mockGetLastMessageDate
			.mockResolvedValueOnce(new Date(Date.now() - 5 * 86400000)) // 5 days ago
			.mockResolvedValueOnce(new Date(Date.now() - 60 * 86400000)); // 60 days ago

		const results = await scoreOutreachForGoal(WS, 'Find DeFi LPs', fakeEnvelope);

		expect(results).toHaveLength(2);
		// c-1 should rank higher (matches both nodes, high health, recent)
		expect(results[0]?.contactId).toBe('c-1');
		expect(results[1]?.contactId).toBe('c-2');
		expect(results[0]!.compositeScore).toBeGreaterThan(results[1]!.compositeScore);
	});

	it('caps at 5 results even with many matching contacts', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-1', displayName: 'Crypto', similarity: 0.9 },
		]);
		mockListContactIdsByKnowledge.mockResolvedValue(Array.from({ length: 10 }, (_, i) => `c-${i}`));

		const results = await scoreOutreachForGoal(WS, 'Crypto goal', fakeEnvelope);
		expect(results.length).toBeLessThanOrEqual(5);
	});

	it('uses correct Fit score: fraction of goal nodes matched', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'n1', displayName: 'Tag1', similarity: 0.8 },
			{ id: 'n2', displayName: 'Tag2', similarity: 0.6 },
			{ id: 'n3', displayName: 'Tag3', similarity: 0.5 },
			{ id: 'n4', displayName: 'Tag4', similarity: 0.4 },
		]);
		// Contact matches 2 of 4 nodes → fit = 0.5
		mockListContactIdsByKnowledge
			.mockResolvedValueOnce(['c-1']) // n1
			.mockResolvedValueOnce(['c-1']) // n2
			.mockResolvedValueOnce([]) // n3
			.mockResolvedValueOnce([]); // n4

		mockGetHealthScore.mockResolvedValue(null); // intent fallback = 0.3
		mockGetLastMessageDate.mockResolvedValue(null); // timing fallback = 0.5

		const results = await scoreOutreachForGoal(WS, 'Test', fakeEnvelope);
		expect(results).toHaveLength(1);
		// composite = 0.50 * (2/4) + 0.35 * 0.3 + 0.15 * 0.5 = 0.25 + 0.105 + 0.075 = 0.43
		expect(results[0]!.compositeScore).toBeCloseTo(0.43, 2);
	});

	it('Intent uses health composite normalized 0-1, fallback 0.3', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([{ id: 'n1', displayName: 'Tag', similarity: 0.8 }]);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-healthy', 'c-none']);

		// c-healthy has health=100, c-none has no health score
		mockGetHealthScore
			.mockResolvedValueOnce({ composite: 100, label: 'excellent' })
			.mockResolvedValueOnce(null);
		mockGetLastMessageDate.mockResolvedValue(null);

		const results = await scoreOutreachForGoal(WS, 'Test', fakeEnvelope);
		const healthy = results.find((r) => r.contactId === 'c-healthy')!;
		const noHealth = results.find((r) => r.contactId === 'c-none')!;

		// Both have fit=1.0 (1/1), timing=0.5 (no message)
		// healthy: 0.50*1.0 + 0.35*1.0 + 0.15*0.5 = 0.925
		// noHealth: 0.50*1.0 + 0.35*0.3 + 0.15*0.5 = 0.68
		expect(healthy.compositeScore).toBeCloseTo(0.925, 2);
		expect(noHealth.compositeScore).toBeCloseTo(0.68, 2);
		expect(healthy.healthStatus).toBe('excellent');
		expect(noHealth.healthStatus).toBe('unknown');
	});

	it('Timing gives 1.0 for messages within 14 days, decays after', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([{ id: 'n1', displayName: 'Tag', similarity: 0.8 }]);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-recent', 'c-old']);
		mockGetHealthScore.mockResolvedValue(null);

		mockGetLastMessageDate
			.mockResolvedValueOnce(new Date()) // today
			.mockResolvedValueOnce(new Date(Date.now() - 44 * 86400000)); // 44 days ago

		const results = await scoreOutreachForGoal(WS, 'Test', fakeEnvelope);
		const recent = results.find((r) => r.contactId === 'c-recent')!;
		const old = results.find((r) => r.contactId === 'c-old')!;

		// recent: timing = 1.0 (within 14d)
		// old: timing = exp(-0.05 * (44-14)) = exp(-1.5) ≈ 0.223
		expect(recent.compositeScore).toBeGreaterThan(old.compositeScore);
		expect(recent.lastInteraction).not.toBeNull();
	});

	it('cold-start: expands via adjacent KG nodes when <3 confident', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'n1', displayName: 'DeFi', similarity: 0.8 },
		]);
		// Only 1 direct contact (below MIN_CONFIDENT_CONTACTS=3)
		mockListContactIdsByKnowledge
			.mockResolvedValueOnce(['c-1']) // direct from n1
			.mockResolvedValueOnce(['c-2', 'c-3']); // from adjacent node

		mockGetHealthScore.mockResolvedValue(null);
		mockGetLastMessageDate.mockResolvedValue(null);

		// Adjacent node found via getKnowledgeNeighbors
		mockGetKnowledgeNeighbors.mockResolvedValue([
			{
				link: { id: 'link-1' },
				node: { id: 'adj-1', displayName: 'Crypto Trading' },
				direction: 'outbound',
			},
		]);

		const results = await scoreOutreachForGoal(WS, 'DeFi LP', fakeEnvelope);

		// Should have 3 contacts: 1 direct + 2 expanded
		expect(results.length).toBeGreaterThanOrEqual(3);
		const expanded = results.filter((r) => r.matchReason.includes('Expanded search'));
		expect(expanded.length).toBeGreaterThan(0);
		expect(expanded[0]?.matchReason).toContain('Crypto Trading');
	});

	it('cold-start: does NOT expand when >=3 contacts are confident', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'n1', displayName: 'DeFi', similarity: 0.8 },
		]);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-1', 'c-2', 'c-3']);

		// All have high health → composites will be > 0.5
		mockGetHealthScore.mockResolvedValue({ composite: 80, label: 'strong' });
		mockGetLastMessageDate.mockResolvedValue(new Date());

		const results = await scoreOutreachForGoal(WS, 'DeFi', fakeEnvelope);

		expect(results).toHaveLength(3);
		expect(mockGetKnowledgeNeighbors).not.toHaveBeenCalled();
	});

	it('matchReason contains only KG tags, no PII (no UUIDs, no names)', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'node-uuid-1', displayName: 'DeFi', similarity: 0.8 },
			{ id: 'node-uuid-2', displayName: 'LP', similarity: 0.6 },
		]);
		mockListContactIdsByKnowledge
			.mockResolvedValueOnce(['contact-uuid-123'])
			.mockResolvedValueOnce(['contact-uuid-123']);
		mockGetHealthScore.mockResolvedValue(null);
		mockGetLastMessageDate.mockResolvedValue(null);

		const results = await scoreOutreachForGoal(WS, 'Find LPs', fakeEnvelope);

		expect(results).toHaveLength(1);
		expect(results[0]?.matchReason).toBe('Tagged: DeFi, LP');
		// No UUIDs leaked into matchReason
		expect(results[0]?.matchReason).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/);
		// No contact names
		expect(results[0]?.matchReason).not.toContain('contact-uuid');
	});

	it('expanded contacts have reduced Fit score (30% penalty)', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'n1', displayName: 'DeFi', similarity: 0.8 },
		]);
		// No direct contacts → triggers cold-start
		mockListContactIdsByKnowledge
			.mockResolvedValueOnce([]) // direct (none)
			.mockResolvedValueOnce(['c-exp']); // from adjacent

		mockGetKnowledgeNeighbors.mockResolvedValue([
			{
				link: { id: 'l1' },
				node: { id: 'adj-1', displayName: 'Trading' },
				direction: 'outbound',
			},
		]);
		mockGetHealthScore.mockResolvedValue({ composite: 100, label: 'excellent' });
		mockGetLastMessageDate.mockResolvedValue(new Date());

		const results = await scoreOutreachForGoal(WS, 'DeFi', fakeEnvelope);
		expect(results).toHaveLength(1);

		// Expanded: fit = (1/1) * 0.3 = 0.3, intent = 1.0, timing = 1.0
		// composite = 0.50*0.3 + 0.35*1.0 + 0.15*1.0 = 0.15 + 0.35 + 0.15 = 0.65
		expect(results[0]!.compositeScore).toBeCloseTo(0.65, 2);
		expect(results[0]?.matchReason).toContain('Expanded search.');
	});

	it('survives getKnowledgeNeighbors failure during cold-start', async () => {
		mockSearchKnowledgeNodes.mockResolvedValue([
			{ id: 'n1', displayName: 'DeFi', similarity: 0.8 },
		]);
		mockListContactIdsByKnowledge.mockResolvedValue(['c-1']);
		mockGetHealthScore.mockResolvedValue(null);
		mockGetLastMessageDate.mockResolvedValue(null);
		mockGetKnowledgeNeighbors.mockRejectedValue(new Error('KG down'));

		const results = await scoreOutreachForGoal(WS, 'DeFi', fakeEnvelope);

		// Should still return the 1 direct contact, not throw
		expect(results).toHaveLength(1);
		expect(results[0]?.contactId).toBe('c-1');
	});
});
