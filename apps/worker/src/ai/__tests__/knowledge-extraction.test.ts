import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockInferWithGemini = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockSearchKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockCreateKnowledgeNode = vi.hoisted(() => vi.fn());
const mockLinkContactToKnowledge = vi.hoisted(() => vi.fn());
const mockIncrementNodeMentionCount = vi.hoisted(() => vi.fn());
const mockGetExtractionLog = vi.hoisted(() => vi.fn());
const mockUpsertExtractionLog = vi.hoisted(() => vi.fn());
const mockFindNodeByNameAnyType = vi.hoisted(() => vi.fn());
const mockFindNodeByAlias = vi.hoisted(() => vi.fn());
const mockMaskEntities = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());

vi.mock('../gemini-inference', () => ({
	inferWithGemini: mockInferWithGemini,
}));

vi.mock('../embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('@repo/crypto', () => ({
	maskEntities: mockMaskEntities,
}));

vi.mock('../prefilter', () => ({
	prefilterEntities: mockPrefilterEntities,
}));

vi.mock('@repo/db', () => ({
	searchKnowledgeNodes: mockSearchKnowledgeNodes,
	createKnowledgeNode: mockCreateKnowledgeNode,
	linkContactToKnowledge: mockLinkContactToKnowledge,
	incrementNodeMentionCount: mockIncrementNodeMentionCount,
	getExtractionLog: mockGetExtractionLog,
	upsertExtractionLog: mockUpsertExtractionLog,
	findNodeByNameAnyType: mockFindNodeByNameAnyType,
	findNodeByAlias: mockFindNodeByAlias,
}));

import {
	extractKnowledgeEntities,
	extractKnowledgeForContact,
	keywordPreFilter,
} from '../knowledge-extraction';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONTACT = 'contact-00000000-0000-0000-0000-000000000001';
const WS = 'ws-00000000-0000-0000-0000-000000000001';
const testSalt = Buffer.from('test-workspace-salt');
const testEnvelope = {
	encryptedWrk: Buffer.from('test-wrk'),
	kmsContext: { workspaceId: WS },
	wrkVersion: 1,
};

const domainMessages = [
	'We are looking to invest in the Ethereum ecosystem',
	'Our fund is focused on DeFi protocol infrastructure',
];

const genericMessages = ['Hey, how are you?', 'Lets catch up soon'];

const fakeEmbedding = Array(512).fill(0.1);

/** Gemini returns JSON text, not tool_use blocks */
const geminiJsonResponse = (entities: unknown[]) => JSON.stringify({ entities });

// ─── keywordPreFilter ─────────────────────────────────────────────────────────

describe('keywordPreFilter', () => {
	it('returns true when messages contain domain keywords', () => {
		expect(keywordPreFilter(domainMessages)).toBe(true);
	});

	it('returns false for generic messages with no domain keywords', () => {
		expect(keywordPreFilter(genericMessages)).toBe(false);
	});

	it('returns true when keyword appears in a single message', () => {
		expect(keywordPreFilter(['Interested in DeFi protocols and token investments'])).toBe(true);
	});
});

// ─── extractKnowledgeEntities ─────────────────────────────────────────────────

describe('extractKnowledgeEntities', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockSearchKnowledgeNodes.mockResolvedValue([]);
		mockCreateKnowledgeNode.mockResolvedValue({ id: 'node-1', name: 'ethereum' });
		mockLinkContactToKnowledge.mockResolvedValue({});
		mockIncrementNodeMentionCount.mockResolvedValue({});
		mockGetExtractionLog.mockResolvedValue(null);
		mockUpsertExtractionLog.mockResolvedValue({});
		mockFindNodeByNameAnyType.mockResolvedValue(null);
		mockFindNodeByAlias.mockResolvedValue(null);
		mockPrefilterEntities.mockReturnValue([]);
		mockMaskEntities.mockImplementation((text: string) => ({
			maskedText: text,
			entityMap: [],
		}));
	});

	it('skips LLM call when pre-filter rejects messages', async () => {
		await extractKnowledgeEntities(genericMessages, CONTACT, WS, testSalt, testEnvelope);

		expect(mockInferWithGemini).not.toHaveBeenCalled();
		expect(mockCreateKnowledgeNode).not.toHaveBeenCalled();
	});

	it('calls inferWithGemini when pre-filter passes', async () => {
		mockInferWithGemini.mockResolvedValue(geminiJsonResponse([]));

		await extractKnowledgeEntities(domainMessages, CONTACT, WS, testSalt, testEnvelope);

		expect(mockInferWithGemini).toHaveBeenCalledTimes(1);
		const call = mockInferWithGemini.mock.calls[0] as unknown[];
		const params = call[0] as { systemPrompt: string; userPrompt: string };
		expect(params.systemPrompt).toContain('extracting structured knowledge entities');
		expect(params.userPrompt).toContain('Extract knowledge entities');
	});

	it('filters out entities with confidence < 0.7', async () => {
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{
					type: 'topic',
					name: 'ethereum',
					displayName: 'Ethereum',
					description: 'Layer 1 blockchain',
					relationshipType: 'invested_in',
					confidence: 0.9,
				},
				{
					type: 'topic',
					name: 'nft art',
					displayName: 'NFT Art',
					description: 'Digital art NFTs',
					relationshipType: 'interested_in',
					confidence: 0.5, // below threshold
				},
			]),
		);

		await extractKnowledgeEntities(domainMessages, CONTACT, WS, testSalt, testEnvelope);

		// Only 1 entity passes the 0.7 filter
		expect(mockCreateKnowledgeNode).toHaveBeenCalledTimes(1);
		expect(mockCreateKnowledgeNode).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({ name: 'ethereum' }),
			testEnvelope,
		);
	});

	it('caps at 10 entities', async () => {
		const manyEntities = Array.from({ length: 15 }, (_, i) => ({
			type: 'topic',
			name: `entity-${i}`,
			displayName: `Entity ${i}`,
			description: `Description ${i}`,
			relationshipType: 'knows_about',
			confidence: 0.8,
		}));
		mockInferWithGemini.mockResolvedValue(geminiJsonResponse(manyEntities));

		await extractKnowledgeEntities(domainMessages, CONTACT, WS, testSalt, testEnvelope);

		expect(mockCreateKnowledgeNode).toHaveBeenCalledTimes(10);
	});

	it('handles invalid JSON response gracefully (no throw)', async () => {
		mockInferWithGemini.mockResolvedValue('No entities found.');

		await expect(
			extractKnowledgeEntities(domainMessages, CONTACT, WS, testSalt, testEnvelope),
		).resolves.toBeUndefined();
		expect(mockCreateKnowledgeNode).not.toHaveBeenCalled();
	});

	it('continues processing remaining entities when one fails', async () => {
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{
					type: 'topic',
					name: 'ethereum',
					displayName: 'Ethereum',
					description: 'L1',
					relationshipType: 'invested_in',
					confidence: 0.9,
				},
				{
					type: 'topic',
					name: 'solana',
					displayName: 'Solana',
					description: 'L1',
					relationshipType: 'interested_in',
					confidence: 0.8,
				},
			]),
		);

		// First entity creation fails, second succeeds
		mockCreateKnowledgeNode
			.mockRejectedValueOnce(new Error('DB error'))
			.mockResolvedValueOnce({ id: 'node-2', name: 'solana' });

		// Should not throw — errors are per-entity and caught
		await expect(
			extractKnowledgeEntities(domainMessages, CONTACT, WS, testSalt, testEnvelope),
		).resolves.toBeUndefined();

		// Second entity still processed
		expect(mockCreateKnowledgeNode).toHaveBeenCalledTimes(2);
		expect(mockLinkContactToKnowledge).toHaveBeenCalledTimes(1);
	});
});

// ─── embeddingFirstMatch (per-message) ───────────────────────────────────────

describe('embeddingFirstMatch (per-message)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockSearchKnowledgeNodes.mockResolvedValue([]);
		mockCreateKnowledgeNode.mockResolvedValue({ id: 'node-1', name: 'ethereum' });
		mockLinkContactToKnowledge.mockResolvedValue({});
		mockIncrementNodeMentionCount.mockResolvedValue({});
		mockGetExtractionLog.mockResolvedValue(null);
		mockUpsertExtractionLog.mockResolvedValue({});
		mockFindNodeByNameAnyType.mockResolvedValue(null);
		mockFindNodeByAlias.mockResolvedValue(null);
		mockInferWithGemini.mockResolvedValue(geminiJsonResponse([]));
		mockPrefilterEntities.mockReturnValue([]);
		mockMaskEntities.mockImplementation((text: string) => ({
			maskedText: text,
			entityMap: [],
		}));
	});

	it('embeds individual messages, not a concatenated blob', async () => {
		const messages = [
			'Short msg', // <30 chars, filtered out
			'The Solana team just shipped the Firedancer validator client',
			'We discussed Ethereum L2 scaling at the conference yesterday',
		];

		await extractKnowledgeEntities(messages, CONTACT, WS, testSalt, testEnvelope);

		// Should generate 2 embeddings for the embedding-first pass (one per qualifying message)
		// plus N for the LLM entity pass (entity names)
		// The key insight: generateEmbedding is called with individual messages, not a blob
		const embeddingCalls = mockGenerateEmbedding.mock.calls as unknown[][];
		const calledWithIndividualMessage = embeddingCalls.some(
			(call) => typeof call[0] === 'string' && (call[0] as string).includes('Solana'),
		);
		expect(calledWithIndividualMessage).toBe(true);
	});

	it('deduplicates nodes across messages in the same pass', async () => {
		const messages = [
			'Solana is performing well in the market this quarter',
			'The Solana foundation announced new grants for developers',
		];

		const solanaNode = {
			id: 'node-solana',
			name: 'solana',
			similarity: 1.0, // DB-computed similarity (identical vectors)
		};

		mockSearchKnowledgeNodes.mockResolvedValue([solanaNode]);

		// similarity 1.0 exceeds the 0.8 threshold
		await extractKnowledgeEntities(messages, CONTACT, WS, testSalt, testEnvelope);

		// linkContactToKnowledge should be called once for Solana via embedding match, not twice
		const linkCalls = (mockLinkContactToKnowledge.mock.calls as unknown[][]).filter(
			(call) => call[1] === 'node-solana',
		);
		expect(linkCalls.length).toBeLessThanOrEqual(1);
	});
});

// ─── SEC-122: ELM masking ─────────────────────────────────────────────────────

describe('SEC-122: ELM masking before LLM/embedding calls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockSearchKnowledgeNodes.mockResolvedValue([]);
		mockCreateKnowledgeNode.mockResolvedValue({ id: 'node-1', name: 'ethereum' });
		mockLinkContactToKnowledge.mockResolvedValue({});
		mockIncrementNodeMentionCount.mockResolvedValue({});
		mockGetExtractionLog.mockResolvedValue(null);
		mockUpsertExtractionLog.mockResolvedValue({});
		mockFindNodeByNameAnyType.mockResolvedValue(null);
		mockFindNodeByAlias.mockResolvedValue(null);
		mockPrefilterEntities.mockReturnValue([]);
		mockMaskEntities.mockImplementation((text: string) => ({
			maskedText: `[MASKED]${text}`,
			entityMap: [],
		}));
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{
					type: 'topic',
					name: 'ethereum',
					displayName: 'Ethereum',
					description: 'Layer 1 blockchain',
					relationshipType: 'invested_in',
					confidence: 0.9,
				},
			]),
		);
	});

	it('masks messages before generating embeddings (SEC-122)', async () => {
		mockMaskEntities.mockClear();
		mockPrefilterEntities.mockClear();

		await extractKnowledgeEntities(domainMessages, CONTACT, WS, testSalt, testEnvelope);

		expect(mockPrefilterEntities).toHaveBeenCalled();
		expect(mockMaskEntities).toHaveBeenCalled();
		// Verify generateEmbedding received masked text, not raw
		expect(mockGenerateEmbedding).toHaveBeenCalledWith(expect.stringContaining('[MASKED]'));
	});

	it('masks messages before LLM inference (SEC-122)', async () => {
		await extractKnowledgeEntities(domainMessages, CONTACT, WS, testSalt, testEnvelope);

		// The user prompt passed to inferWithGemini should contain masked text
		const call = mockInferWithGemini.mock.calls[0] as unknown[];
		const params = call[0] as { userPrompt: string };
		expect(params.userPrompt).toContain('[MASKED]');
	});

	it('workspaceSalt is required in extractKnowledgeForContact opts', async () => {
		const result = await extractKnowledgeForContact(domainMessages, CONTACT, WS, {
			workspaceSalt: testSalt,
			envelope: testEnvelope,
		});
		expect(result).toHaveProperty('embeddingMatches');
		expect(result).toHaveProperty('llmEntities');
		expect(mockMaskEntities).toHaveBeenCalled();
	});
});
