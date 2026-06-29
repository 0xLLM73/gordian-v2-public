import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockInferWithGemini = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockGenerateEmbeddingsCached = vi.hoisted(() => vi.fn());
const mockSearchKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockCreateKnowledgeNode = vi.hoisted(() => vi.fn());
const mockCreateKnowledgeEvidence = vi.hoisted(() => vi.fn());
const mockLinkContactToKnowledge = vi.hoisted(() => vi.fn());
const mockIncrementNodeMentionCount = vi.hoisted(() => vi.fn());
const mockGetExtractionLog = vi.hoisted(() => vi.fn());
const mockUpsertExtractionLog = vi.hoisted(() => vi.fn());
const mockFindNodeByNameAnyType = vi.hoisted(() => vi.fn());
const mockFindNodeByAlias = vi.hoisted(() => vi.fn());
const mockUpsertKnowledgeRelationshipCandidate = vi.hoisted(() => vi.fn());
const mockPromoteKnowledgeRelationshipCandidate = vi.hoisted(() => vi.fn());
const mockMaskEntities = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());

vi.mock('../gemini-inference', () => ({
	inferWithGemini: mockInferWithGemini,
}));

vi.mock('../embeddings', () => ({
	generateEmbeddingCached: mockGenerateEmbedding,
	generateEmbeddingsCached: mockGenerateEmbeddingsCached,
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
	createKnowledgeEvidence: mockCreateKnowledgeEvidence,
	linkContactToKnowledge: mockLinkContactToKnowledge,
	incrementNodeMentionCount: mockIncrementNodeMentionCount,
	getExtractionLog: mockGetExtractionLog,
	upsertExtractionLog: mockUpsertExtractionLog,
	findNodeByNameAnyType: mockFindNodeByNameAnyType,
	findNodeByAlias: mockFindNodeByAlias,
	upsertKnowledgeRelationshipCandidate: mockUpsertKnowledgeRelationshipCandidate,
	promoteKnowledgeRelationshipCandidate: mockPromoteKnowledgeRelationshipCandidate,
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
const geminiJsonResponse = (entities: unknown[], relations: unknown[] = []) =>
	JSON.stringify({ entities, relations });

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
		vi.unstubAllEnvs();
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockGenerateEmbeddingsCached.mockImplementation((texts: string[]) =>
			Promise.resolve(texts.map((_text, index) => ({ embedding: fakeEmbedding, index }))),
		);
		mockSearchKnowledgeNodes.mockResolvedValue([]);
		mockCreateKnowledgeNode.mockResolvedValue({ id: 'node-1', name: 'ethereum' });
		mockLinkContactToKnowledge.mockResolvedValue({});
		mockIncrementNodeMentionCount.mockResolvedValue({});
		mockGetExtractionLog.mockResolvedValue(null);
		mockUpsertExtractionLog.mockResolvedValue({});
		mockFindNodeByNameAnyType.mockResolvedValue(null);
		mockFindNodeByAlias.mockResolvedValue(null);
		mockCreateKnowledgeEvidence.mockResolvedValue({ id: 'evidence-rel-1' });
		mockUpsertKnowledgeRelationshipCandidate.mockResolvedValue({
			id: 'candidate-1',
			promotionStatus: 'review_only',
		});
		mockPromoteKnowledgeRelationshipCandidate.mockResolvedValue({ promoted: false });
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

	it('skips LLM extraction when the KG LLM provider is disabled', async () => {
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'disabled');

		await extractKnowledgeEntities(domainMessages, CONTACT, WS, testSalt, testEnvelope);

		expect(mockInferWithGemini).not.toHaveBeenCalled();
		expect(mockUpsertExtractionLog).toHaveBeenCalledWith(
			WS,
			CONTACT,
			expect.objectContaining({ llmCalled: false }),
		);
	});

	it('records the latest processed message timestamp as messageHorizon', async () => {
		const latestTimestamp = '2026-05-03T14:30:00.000Z';
		mockInferWithGemini.mockResolvedValue(geminiJsonResponse([]));

		await extractKnowledgeEntities(
			[
				{
					id: 'msg-older',
					text: 'We are researching Ethereum protocol infrastructure',
					timestamp: '2026-05-01T12:00:00.000Z',
				},
				{
					id: 'msg-latest',
					text: 'Solana validator infrastructure is the current project focus',
					timestamp: latestTimestamp,
				},
			],
			CONTACT,
			WS,
			testSalt,
			testEnvelope,
		);

		expect(mockUpsertExtractionLog).toHaveBeenCalledWith(
			WS,
			CONTACT,
			expect.objectContaining({
				messageHorizon: new Date(latestTimestamp),
				llmCalled: true,
			}),
		);
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
			expect.objectContaining({
				name: 'ethereum',
				metadata: expect.objectContaining({
					embeddingFingerprintKey:
						'openai:cloud:custom:text-embedding-3-small:512:kg-embedding-format-v1',
				}),
			}),
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

	it('writes evidence metadata when message ids and timestamps are available', async () => {
		const occurredAt = '2026-05-01T12:00:00.000Z';
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{
					type: 'technology',
					name: 'solana',
					displayName: 'Solana',
					description: 'Layer 1 blockchain',
					relationshipType: 'works_on',
					confidence: 0.92,
				},
			]),
		);

		await extractKnowledgeEntities(
			[
				{
					id: 'msg-1',
					text: 'We are building Solana validator infrastructure for the next launch',
					timestamp: occurredAt,
				},
			],
			CONTACT,
			WS,
			testSalt,
			testEnvelope,
		);

		expect(mockLinkContactToKnowledge).toHaveBeenCalledWith(
			WS,
			'node-1',
			CONTACT,
			'works_on',
			0.92,
			expect.objectContaining({
				messageId: 'msg-1',
				snippet: expect.stringContaining('Solana validator'),
				occurredAt: new Date(occurredAt),
				evidenceKind: 'llm_extracted',
				confidence: 0.92,
				metadata: expect.objectContaining({
					source: 'gemini_flash',
					entityType: 'technology',
					sourceMessageSelection: {
						method: 'exact_normalized_name',
						sourceBacked: true,
					},
				}),
				envelope: testEnvelope,
			}),
		);
		const metadata = mockLinkContactToKnowledge.mock.calls[0]?.[5]?.metadata as Record<
			string,
			unknown
		>;
		expect(metadata.normalizedName).toBeUndefined();
		expect(JSON.stringify(metadata)).not.toContain('solana');
	});

	it('selects the source message with an exact entity mention from a batch', async () => {
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{
					type: 'project',
					name: 'solana',
					displayName: 'Solana',
					description: 'Layer 1 blockchain',
					relationshipType: 'interested_in',
					confidence: 0.88,
				},
			]),
		);

		await extractKnowledgeEntities(
			[
				{
					id: 'msg-older',
					text: 'We should catch up about protocol research',
					timestamp: '2026-05-01T00:00:00Z',
				},
				{
					id: 'msg-source',
					text: 'Solana infra is the thing I am focused on',
					timestamp: '2026-05-02T00:00:00Z',
				},
				{
					id: 'msg-latest',
					text: 'Conference logistics for next week',
					timestamp: '2026-05-03T00:00:00Z',
				},
			],
			CONTACT,
			WS,
			testSalt,
			testEnvelope,
		);

		expect(mockLinkContactToKnowledge).toHaveBeenCalledWith(
			WS,
			'node-1',
			CONTACT,
			'interested_in',
			0.88,
			expect.objectContaining({
				messageId: 'msg-source',
				snippet: expect.stringContaining('Solana infra'),
				metadata: expect.objectContaining({
					sourceMessageSelection: {
						method: 'exact_normalized_name',
						sourceBacked: true,
					},
				}),
			}),
		);
	});

	it('falls back safely when source message id is missing', async () => {
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{
					type: 'topic',
					name: 'defi',
					displayName: 'DeFi',
					description: 'Decentralized finance',
					relationshipType: 'knows_about',
					confidence: 0.83,
				},
			]),
		);

		await extractKnowledgeEntities(
			[{ text: 'DeFi liquidity keeps coming up', timestamp: '2026-05-04T00:00:00Z' }],
			CONTACT,
			WS,
			testSalt,
			testEnvelope,
		);

		expect(mockLinkContactToKnowledge).toHaveBeenCalledWith(
			WS,
			'node-1',
			CONTACT,
			'knows_about',
			0.83,
			expect.objectContaining({
				messageId: undefined,
				snippet: expect.stringContaining('DeFi liquidity'),
				metadata: expect.objectContaining({
					sourceMessageSelection: {
						method: 'exact_normalized_name',
						sourceBacked: true,
					},
				}),
			}),
		);
	});

	it('uses model-provided sourceMention when entity names do not appear verbatim', async () => {
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{
					type: 'project',
					name: 'solana validator program',
					displayName: 'Solana Validator Program',
					description: 'Validator launch work',
					relationshipType: 'works_on',
					confidence: 0.9,
					sourceMention: 'validator launch',
				},
			]),
		);

		await extractKnowledgeEntities(
			[
				{
					id: 'msg-mention',
					text: 'The validator launch is my main workstream this month',
					timestamp: '2026-05-05T00:00:00Z',
				},
			],
			CONTACT,
			WS,
			testSalt,
			testEnvelope,
		);

		expect(mockLinkContactToKnowledge).toHaveBeenCalledWith(
			WS,
			'node-1',
			CONTACT,
			'works_on',
			0.9,
			expect.objectContaining({
				messageId: 'msg-mention',
				metadata: expect.objectContaining({
					sourceMessageSelection: {
						method: 'mention_span',
						sourceBacked: true,
					},
				}),
			}),
		);
	});

	it('does not reuse a semantically close node when the source text does not support that node', async () => {
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{
					type: 'technology',
					name: 'solana',
					displayName: 'Solana',
					description: 'Layer 1 blockchain',
					relationshipType: 'uses',
					confidence: 0.82,
				},
			]),
		);
		mockSearchKnowledgeNodes.mockResolvedValueOnce([
			{
				id: 'node-dspy',
				name: 'dspy',
				displayName: 'DSPy',
				type: 'technology',
				aliases: [],
				similarity: 0.86,
			},
		]);
		mockCreateKnowledgeNode.mockResolvedValueOnce({
			id: 'node-solana',
			name: 'solana',
			displayName: 'Solana',
			type: 'technology',
		});

		await extractKnowledgeEntities(
			[
				{
					id: 'msg-solana',
					text: 'Solana project',
					timestamp: '2026-05-06T00:00:00Z',
				},
			],
			CONTACT,
			WS,
			testSalt,
			testEnvelope,
		);

		expect(mockCreateKnowledgeNode).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({ name: 'solana', displayName: 'Solana' }),
			testEnvelope,
		);
		expect(mockLinkContactToKnowledge).toHaveBeenCalledWith(
			WS,
			'node-solana',
			CONTACT,
			'uses',
			0.82,
			expect.objectContaining({
				messageId: 'msg-solana',
				snippet: expect.stringContaining('Solana project'),
			}),
		);
		expect(
			mockLinkContactToKnowledge.mock.calls.some((call) => (call as unknown[])[1] === 'node-dspy'),
		).toBe(false);
	});

	it('stores and promotes quote-backed LLM relationship candidates', async () => {
		const messageId = '00000000-0000-4000-8000-000000000101';
		const quote = 'Solana depends on Jito for this rollout';
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse(
				[
					{
						type: 'technology',
						name: 'solana',
						displayName: 'Solana',
						description: 'Layer 1 blockchain',
						relationshipType: 'works_on',
						confidence: 0.91,
					},
					{
						type: 'technology',
						name: 'jito',
						displayName: 'Jito',
						description: 'Validator infrastructure',
						relationshipType: 'uses',
						confidence: 0.9,
					},
				],
				[
					{
						head_mention: 'Solana',
						tail_mention: 'Jito',
						relation_type: 'DEPENDS_ON',
						direction: 'head_to_tail',
						source_message_id: messageId,
						quote,
						is_explicit: true,
						negated: false,
						confirmed_eligible: true,
						temporal_status: 'current',
						confidence: 0.86,
					},
				],
			),
		);
		mockCreateKnowledgeNode
			.mockResolvedValueOnce({ id: 'node-solana', name: 'solana', displayName: 'Solana' })
			.mockResolvedValueOnce({ id: 'node-jito', name: 'jito', displayName: 'Jito' });
		mockUpsertKnowledgeRelationshipCandidate.mockResolvedValue({
			id: 'candidate-1',
			promotionStatus: 'eligible',
		});
		mockPromoteKnowledgeRelationshipCandidate.mockResolvedValue({ promoted: true });

		await extractKnowledgeEntities(
			[
				{
					id: messageId,
					text: `${quote}. We will invest in protocol infrastructure around it.`,
					timestamp: '2026-05-07T00:00:00Z',
				},
			],
			CONTACT,
			WS,
			testSalt,
			testEnvelope,
		);

		expect(mockCreateKnowledgeEvidence).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				knowledgeNodeId: 'node-solana',
				relatedKnowledgeNodeId: 'node-jito',
				messageId,
				relationType: 'depends_on',
				evidenceKind: 'llm_extracted',
				confidence: 0.86,
				snippet: quote,
				evidenceChunk: expect.objectContaining({
					chunkKind: 'quote_window',
					maskedText: quote,
					embedding: fakeEmbedding,
					embeddingFingerprint:
						'openai:cloud:custom:text-embedding-3-small:512:kg-embedding-format-v1',
				}),
				metadata: expect.objectContaining({
					confirmedEligible: true,
					inferenceSource: 'gemini_flash',
					isExplicit: true,
					negated: false,
					quoteVerified: true,
					temporalStatus: 'current',
				}),
			}),
			testEnvelope,
		);
		expect(mockUpsertKnowledgeRelationshipCandidate).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				sourceNodeId: 'node-solana',
				targetNodeId: 'node-jito',
				linkType: 'depends_on',
				evidenceKind: 'llm_extracted',
				confidence: 0.86,
				sourceEvidenceId: 'evidence-rel-1',
				messageId,
				metadata: expect.objectContaining({
					confirmedEligible: true,
					isExplicit: true,
					quoteVerified: true,
					sourcePromptMessageId: messageId,
				}),
			}),
		);
		expect(mockPromoteKnowledgeRelationshipCandidate).toHaveBeenCalledWith(WS, 'candidate-1');
	});

	it('keeps weak or unverified LLM relationships in the review queue', async () => {
		const messageId = '00000000-0000-4000-8000-000000000102';
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse(
				[
					{
						type: 'technology',
						name: 'solana',
						displayName: 'Solana',
						description: 'Layer 1 blockchain',
						relationshipType: 'works_on',
						confidence: 0.91,
					},
					{
						type: 'technology',
						name: 'jito',
						displayName: 'Jito',
						description: 'Validator infrastructure',
						relationshipType: 'uses',
						confidence: 0.9,
					},
				],
				[
					{
						head_mention: 'Solana',
						tail_mention: 'Jito',
						relation_type: 'DEPENDS_ON',
						source_message_id: messageId,
						quote: 'Solana depends on Jito',
						is_explicit: false,
						negated: false,
						confirmed_eligible: false,
						temporal_status: 'unknown',
						confidence: 0.7,
					},
				],
			),
		);
		mockCreateKnowledgeNode
			.mockResolvedValueOnce({ id: 'node-solana', name: 'solana', displayName: 'Solana' })
			.mockResolvedValueOnce({ id: 'node-jito', name: 'jito', displayName: 'Jito' });

		await extractKnowledgeEntities(
			[
				{
					id: messageId,
					text: 'Solana and Jito were both mentioned as protocol infrastructure topics.',
					timestamp: '2026-05-08T00:00:00Z',
				},
			],
			CONTACT,
			WS,
			testSalt,
			testEnvelope,
		);

		expect(mockCreateKnowledgeEvidence).not.toHaveBeenCalled();
		expect(mockUpsertKnowledgeRelationshipCandidate).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				sourceNodeId: 'node-solana',
				targetNodeId: 'node-jito',
				linkType: 'depends_on',
				sourceEvidenceId: null,
				messageId,
				metadata: expect.objectContaining({
					confirmedEligible: false,
					isExplicit: false,
					quoteVerified: false,
				}),
			}),
		);
		expect(mockPromoteKnowledgeRelationshipCandidate).not.toHaveBeenCalled();
	});
});

// ─── embeddingFirstMatch (per-message) ───────────────────────────────────────

describe('embeddingFirstMatch (per-message)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockGenerateEmbeddingsCached.mockImplementation((texts: string[]) =>
			Promise.resolve(texts.map((_text, index) => ({ embedding: fakeEmbedding, index }))),
		);
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

		const embeddingBatchCalls = mockGenerateEmbeddingsCached.mock.calls as unknown[][];
		const firstBatch = embeddingBatchCalls[0]?.[0] as string[];
		expect(firstBatch.some((text) => text.includes('Solana'))).toBe(true);
		expect(firstBatch.join('\n')).not.toContain(messages.join(' '));
		expect(embeddingBatchCalls[0]?.[1]).toEqual({ purpose: 'document' });
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
		expect(linkCalls[0]?.[5]).toEqual(
			expect.objectContaining({
				evidenceKind: 'embedding_match',
				evidenceChunk: expect.objectContaining({
					chunkKind: 'message_window',
					maskedText: expect.stringContaining('Solana'),
					embedding: fakeEmbedding,
					embeddingFingerprint:
						'openai:cloud:custom:text-embedding-3-small:512:kg-embedding-format-v1',
					maskingPolicyVersion: 'mask-v1',
					chunkingPolicyVersion: 'evidence-window-v1',
				}),
			}),
		);
	});
});

// ─── SEC-122: ELM masking ─────────────────────────────────────────────────────

describe('SEC-122: ELM masking before LLM/embedding calls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockGenerateEmbeddingsCached.mockImplementation((texts: string[]) =>
			Promise.resolve(texts.map((_text, index) => ({ embedding: fakeEmbedding, index }))),
		);
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
		expect(mockGenerateEmbedding).toHaveBeenCalledWith(expect.stringContaining('[MASKED]'), {
			purpose: 'dedup',
		});
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
