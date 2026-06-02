import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAnthropicBatchCreate = vi.hoisted(() => vi.fn());
const mockInferKnowledgeEntitiesJson = vi.hoisted(() => vi.fn());
const mockUpsertExtractionLog = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
	default: class MockAnthropic {
		messages = {
			batches: {
				create: mockAnthropicBatchCreate,
			},
		};
	},
}));

vi.mock('@repo/crypto', () => ({
	maskEntities: vi.fn((text: string) => ({ maskedText: text })),
}));

vi.mock('@repo/db', () => ({
	createKnowledgeNode: vi.fn(),
	findNodeByAlias: vi.fn(),
	findNodeByNameAnyType: vi.fn(),
	incrementNodeMentionCount: vi.fn(),
	linkContactToKnowledge: vi.fn(),
	searchKnowledgeNodes: vi.fn(),
	upsertExtractionLog: mockUpsertExtractionLog,
}));

vi.mock('../embeddings', () => ({
	generateEmbeddingCached: vi.fn(),
}));

vi.mock('../knowledge-llm', () => ({
	inferKnowledgeEntitiesJson: mockInferKnowledgeEntitiesJson,
	normalizeKnowledgeEntities: vi.fn((entities: unknown) =>
		Array.isArray(entities) ? entities : [],
	),
}));

vi.mock('../prefilter', () => ({
	prefilterEntities: vi.fn(() => []),
}));

import { createKnowledgeNode, linkContactToKnowledge, searchKnowledgeNodes } from '@repo/db';
import { BatchRelationshipExtractor } from '../batch-relationship';
import { generateEmbeddingCached } from '../embeddings';

describe('BatchRelationshipExtractor local mode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		mockInferKnowledgeEntitiesJson.mockResolvedValue({
			entities: [],
			source: 'local:test-model',
		});
		mockUpsertExtractionLog.mockResolvedValue(undefined);
	});

	it('bypasses Anthropic Batch and uses the configured KG LLM adapter in local mode', async () => {
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'local');
		const extractor = new BatchRelationshipExtractor();

		extractor.addRequest(
			'ws-1',
			'contact-1',
			[{ id: 'msg-1', text: 'Solana infrastructure', timestamp: '2026-05-01T00:00:00Z' }],
			Buffer.from('salt'),
			{
				encryptedWrk: Buffer.from('wrk'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		const result = await extractor.submitAndProcess();

		expect(mockAnthropicBatchCreate).not.toHaveBeenCalled();
		expect(mockInferKnowledgeEntitiesJson).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining('Respond with ONLY a JSON object'),
				userPrompt: expect.stringContaining('Solana infrastructure'),
			}),
		);
		expect(result).toEqual({ totalLinked: 0, batchUsed: false });
		expect(mockUpsertExtractionLog).toHaveBeenCalledWith(
			'ws-1',
			'contact-1',
			expect.objectContaining({
				entitiesExtracted: 0,
				llmCalled: true,
			}),
		);
	});

	it('does not persist plaintext entity names in evidence metadata', async () => {
		vi.stubEnv('KNOWLEDGE_LLM_PROVIDER', 'local');
		mockInferKnowledgeEntitiesJson.mockResolvedValue({
			entities: [
				{
					type: 'project',
					name: 'solana',
					displayName: 'Solana',
					description: 'Layer 1',
					relationshipType: 'knows_about',
					confidence: 0.9,
				},
			],
			source: 'local:test-model',
		});
		vi.mocked(generateEmbeddingCached).mockResolvedValue(Array(512).fill(0.1));
		vi.mocked(searchKnowledgeNodes).mockResolvedValue([]);
		vi.mocked(createKnowledgeNode).mockResolvedValue({
			id: 'node-1',
		} as Awaited<ReturnType<typeof createKnowledgeNode>>);
		const extractor = new BatchRelationshipExtractor();

		extractor.addRequest(
			'ws-1',
			'contact-1',
			[{ id: 'msg-1', text: 'Solana infrastructure', timestamp: '2026-05-01T00:00:00Z' }],
			Buffer.from('salt'),
			{
				encryptedWrk: Buffer.from('wrk'),
				kmsContext: { workspaceId: 'ws-1' },
				wrkVersion: 1,
			},
		);

		const result = await extractor.submitAndProcess();

		expect(result.totalLinked).toBe(1);
		const evidence = vi.mocked(linkContactToKnowledge).mock.calls[0]?.[5] as
			| { metadata?: Record<string, unknown> }
			| undefined;
		expect(evidence?.metadata).toEqual({
			source: 'local:test-model',
			entityType: 'project',
			sourceMessageSelection: {
				method: 'exact_normalized_name',
			},
		});
		expect(JSON.stringify(evidence?.metadata)).not.toContain('solana');
	});
});
