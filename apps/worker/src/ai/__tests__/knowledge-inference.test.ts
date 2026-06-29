import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferSimilarityRelationshipCandidates = vi.hoisted(() => vi.fn());
const mockIsFeatureEnabled = vi.hoisted(() => vi.fn());
const mockListKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockListContactIdsByKnowledge = vi.hoisted(() => vi.fn());
const mockUpsertKnowledgeRelationshipCandidate = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	inferSimilarityRelationshipCandidates: mockInferSimilarityRelationshipCandidates,
	isFeatureEnabled: mockIsFeatureEnabled,
	listKnowledgeNodes: mockListKnowledgeNodes,
	listContactIdsByKnowledge: mockListContactIdsByKnowledge,
	upsertKnowledgeRelationshipCandidate: mockUpsertKnowledgeRelationshipCandidate,
}));

import { runKnowledgeInference } from '../knowledge-inference';

const WS = '550e8400-e29b-41d4-a716-446655440000';

describe('runKnowledgeInference', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsFeatureEnabled.mockResolvedValue(true);
		mockUpsertKnowledgeRelationshipCandidate.mockResolvedValue({});
		mockListContactIdsByKnowledge.mockResolvedValue([]);
		mockInferSimilarityRelationshipCandidates.mockResolvedValue(0);
	});

	it('skips when feature flag is off', async () => {
		mockIsFeatureEnabled.mockResolvedValue(false);
		const result = await runKnowledgeInference(WS);
		expect(result).toEqual({
			workspaceId: WS,
			nodesProcessed: 0,
			candidateRelationships: 0,
			coOccurrenceCandidates: 0,
			coOccurrenceLinks: 0,
			confirmedLinks: 0,
			similarityCandidates: 0,
			similarityLinks: 0,
			totalLinks: 0,
			skippedReason: 'feature_flag_off',
		});
		expect(mockListKnowledgeNodes).not.toHaveBeenCalled();
	});

	it('can bypass the feature flag for explicit admin-triggered local inference', async () => {
		mockIsFeatureEnabled.mockResolvedValue(false);
		mockListKnowledgeNodes.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);
		mockInferSimilarityRelationshipCandidates.mockResolvedValue(1);

		const result = await runKnowledgeInference(WS, { requireFeatureFlag: false });

		expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
		expect(mockListKnowledgeNodes).toHaveBeenCalledWith(WS, { limit: 5000 });
		expect(result).toEqual({
			workspaceId: WS,
			nodesProcessed: 2,
			candidateRelationships: 1,
			coOccurrenceCandidates: 0,
			coOccurrenceLinks: 0,
			confirmedLinks: 0,
			similarityCandidates: 1,
			similarityLinks: 0,
			totalLinks: 0,
		});
	});

	it('skips when fewer than 2 nodes', async () => {
		mockListKnowledgeNodes.mockResolvedValue([{ id: 'n1' }]);
		const result = await runKnowledgeInference(WS);
		expect(result.skippedReason).toBe('too_few_nodes');
		expect(result.nodesProcessed).toBe(1);
		expect(mockInferSimilarityRelationshipCandidates).not.toHaveBeenCalled();
	});

	it('calls inferSimilarityRelationshipCandidates with correct threshold', async () => {
		mockListKnowledgeNodes.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);
		mockInferSimilarityRelationshipCandidates.mockResolvedValue(5);
		await runKnowledgeInference(WS);
		expect(mockInferSimilarityRelationshipCandidates).toHaveBeenCalledWith(WS, 0.3);
	});

	it('continues co-occurrence pass even if similarity pass fails', async () => {
		mockListKnowledgeNodes.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);
		mockInferSimilarityRelationshipCandidates.mockRejectedValue(new Error('pg down'));
		await runKnowledgeInference(WS);
		// Should not throw — error is caught and logged
	});

	it('stores co-occurrence candidate with Jaccard weight', async () => {
		const n1 = { id: 'node-1' };
		const n2 = { id: 'node-2' };
		mockListKnowledgeNodes.mockResolvedValue([n1, n2]);

		// Both nodes share 2 contacts, each has 3 contacts total
		// listContactIdsByKnowledge returns string[] of contact IDs
		mockListContactIdsByKnowledge.mockImplementation((nodeId: string) => {
			if (nodeId === 'node-1') {
				return Promise.resolve(['c-1', 'c-2', 'c-3']);
			}
			return Promise.resolve(['c-1', 'c-2', 'c-4']);
		});

		await runKnowledgeInference(WS);

		// Jaccard: 2 / (3 + 3 - 2) = 0.5
		expect(mockUpsertKnowledgeRelationshipCandidate).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				sourceNodeId: expect.any(String),
				targetNodeId: expect.any(String),
				linkType: 'related_to',
				evidenceKind: 'contact_cooccurrence',
				confidence: 0.5,
				promotionStatus: 'review_only',
				metadata: expect.objectContaining({
					method: 'shared_contact_jaccard',
					sharedContactCount: 2,
				}),
			}),
		);
	});

	it('skips co-occurrence edges with Jaccard < 0.05', async () => {
		const n1 = { id: 'node-1' };
		const n2 = { id: 'node-2' };
		mockListKnowledgeNodes.mockResolvedValue([n1, n2]);

		// 2 shared contacts out of 50 total each → Jaccard = 2/(50+50-2) ≈ 0.020
		const contactsA = Array.from({ length: 50 }, (_, i) => `c-${i}`);
		const contactsB = ['c-0', 'c-1', ...Array.from({ length: 48 }, (_, i) => `d-${i}`)];

		mockListContactIdsByKnowledge.mockImplementation((nodeId: string) => {
			if (nodeId === 'node-1') return Promise.resolve(contactsA);
			return Promise.resolve(contactsB);
		});

		await runKnowledgeInference(WS);

		// Jaccard ≈ 0.020 < 0.05 → no co-occurrence link created
		expect(mockUpsertKnowledgeRelationshipCandidate).not.toHaveBeenCalled();
	});
});
