import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockInferWithGemini = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockCreateKnowledgeNode = vi.hoisted(() => vi.fn());
const mockCreateKnowledgeLink = vi.hoisted(() => vi.fn());
const mockSearchKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockFindNodeByNameAnyType = vi.hoisted(() => vi.fn());
const mockIncrementNodeMentionCount = vi.hoisted(() => vi.fn());
const mockLinkContactToKnowledge = vi.hoisted(() => vi.fn());
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
	createKnowledgeNode: mockCreateKnowledgeNode,
	createKnowledgeLink: mockCreateKnowledgeLink,
	searchKnowledgeNodes: mockSearchKnowledgeNodes,
	findNodeByNameAnyType: mockFindNodeByNameAnyType,
	incrementNodeMentionCount: mockIncrementNodeMentionCount,
	linkContactToKnowledge: mockLinkContactToKnowledge,
}));

import type { DecisionContext } from '../rationale-extraction';
import { extractDecisionRationales } from '../rationale-extraction';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';
const CONTACT = 'contact-00000000-0000-0000-0000-000000000001';
const testSalt = Buffer.from('test-workspace-salt');
const fakeEmbedding = Array(512).fill(0.1);

const testEnvelope = {
	encryptedWrk: Buffer.from('test-wrk'),
	kmsContext: { workspaceId: WS },
	wrkVersion: 1,
};

const baseContext: DecisionContext = {
	action: 'deal_lost',
	label: 'Deal stage → lost',
	contactId: CONTACT,
	entityId: 'deal-123',
	entityType: 'deal',
	workspaceId: WS,
	workspaceSalt: testSalt,
	envelope: testEnvelope,
};

const messages = [
	'The tokenomics are really weak, high FDV with no lockup',
	'Team seems solid but the market timing is off for this sector',
];

/** Gemini returns JSON text, not tool_use blocks */
const geminiJsonResponse = (rationales: unknown[], decisionSummary = 'Passed on deal') =>
	JSON.stringify({ rationales, decisionSummary });

const sampleRationales = [
	{
		label: 'weak tokenomics',
		displayLabel: 'Weak Tokenomics',
		description: 'High FDV relative to traction with no lockup period',
		evidenceQuote: 'The tokenomics are really weak, high FDV with no lockup',
		relatedEntities: ['tokenomics'],
		confidence: 0.9,
	},
	{
		label: 'poor market timing',
		displayLabel: 'Poor Market Timing',
		description: 'Sector timing unfavorable for this type of project',
		evidenceQuote: 'the market timing is off for this sector',
		relatedEntities: ['market timing'],
		confidence: 0.8,
	},
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('extractDecisionRationales', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockSearchKnowledgeNodes.mockResolvedValue([]);
		mockCreateKnowledgeNode.mockResolvedValue({ id: 'node-1', name: 'test' });
		mockCreateKnowledgeLink.mockResolvedValue({});
		mockFindNodeByNameAnyType.mockResolvedValue(null);
		mockIncrementNodeMentionCount.mockResolvedValue({});
		mockLinkContactToKnowledge.mockResolvedValue({});
		mockPrefilterEntities.mockReturnValue([]);
		mockMaskEntities.mockImplementation((text: string) => ({
			maskedText: text,
			entityMap: [],
		}));
		mockInferWithGemini.mockResolvedValue(geminiJsonResponse(sampleRationales));
	});

	it('returns early on empty messages', async () => {
		await extractDecisionRationales(baseContext, []);
		expect(mockInferWithGemini).not.toHaveBeenCalled();
	});

	it('creates decision node and rationale nodes', async () => {
		mockCreateKnowledgeNode
			.mockResolvedValueOnce({ id: 'decision-1' }) // decision node
			.mockResolvedValueOnce({ id: 'rationale-1' }) // first rationale
			.mockResolvedValueOnce({ id: 'rationale-2' }); // second rationale

		await extractDecisionRationales(baseContext, messages);

		// Decision node + 2 rationale nodes
		expect(mockCreateKnowledgeNode).toHaveBeenCalledTimes(3);

		// Decision node uses structural displayName (SEC-PROV-009)
		const decisionCall = mockCreateKnowledgeNode.mock.calls[0] as unknown[];
		const decisionData = decisionCall[1] as Record<string, unknown>;
		expect(decisionData.type).toBe('decision');
		expect(decisionData.displayName).toBe('deal_lost — Deal stage → lost');
	});

	it('links contact to decision node', async () => {
		mockCreateKnowledgeNode.mockResolvedValueOnce({ id: 'decision-1' });

		await extractDecisionRationales(baseContext, messages);

		expect(mockLinkContactToKnowledge).toHaveBeenCalledWith(WS, 'decision-1', CONTACT, 'decided');
	});

	it('creates cites links from decision to rationales', async () => {
		mockCreateKnowledgeNode
			.mockResolvedValueOnce({ id: 'decision-1' })
			.mockResolvedValueOnce({ id: 'rationale-1' })
			.mockResolvedValueOnce({ id: 'rationale-2' });

		await extractDecisionRationales(baseContext, messages);

		const citesCalls = (mockCreateKnowledgeLink.mock.calls as unknown[][]).filter(
			(call) => call[3] === 'cites',
		);
		expect(citesCalls.length).toBe(2);
		expect(citesCalls[0][1]).toBe('decision-1'); // source = decision
	});

	it('filters out rationales with confidence < 0.7', async () => {
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{ ...sampleRationales[0], confidence: 0.9 },
				{ ...sampleRationales[1], confidence: 0.5 }, // below threshold
			]),
		);

		mockCreateKnowledgeNode.mockResolvedValueOnce({ id: 'decision-1' });

		await extractDecisionRationales(baseContext, messages);

		// 1 decision + 1 rationale (second filtered out)
		expect(mockCreateKnowledgeNode).toHaveBeenCalledTimes(2);
	});

	it('masks messages before LLM call (SEC-PROV-002)', async () => {
		mockMaskEntities.mockImplementation((text: string) => ({
			maskedText: `[MASKED]${text}`,
			entityMap: [],
		}));

		await extractDecisionRationales(baseContext, messages);

		const call = mockInferWithGemini.mock.calls[0] as unknown[];
		const params = call[0] as { userPrompt: string };
		expect(params.userPrompt).toContain('[MASKED]');
	});

	it('masks embedding inputs before generateEmbedding (SEC-PROV-002)', async () => {
		mockMaskEntities.mockImplementation((text: string) => ({
			maskedText: `[MASKED]${text}`,
			entityMap: [],
		}));

		await extractDecisionRationales(baseContext, messages);

		expect(mockGenerateEmbedding).toHaveBeenCalledWith(expect.stringContaining('[MASKED]'));
	});

	it('masks evidence quotes before storage (SEC-PROV-001)', async () => {
		mockMaskEntities.mockImplementation((text: string) => ({
			maskedText: `[MASKED]${text}`,
			entityMap: [],
		}));
		mockCreateKnowledgeNode
			.mockResolvedValueOnce({ id: 'decision-1' })
			.mockResolvedValueOnce({ id: 'rationale-1' })
			.mockResolvedValueOnce({ id: 'rationale-2' });

		await extractDecisionRationales(baseContext, messages);

		// Rationale node metadata.evidenceQuote should be masked
		const ratCalls = (mockCreateKnowledgeNode.mock.calls as unknown[][]).filter(
			(call) => (call[1] as Record<string, unknown>).type === 'rationale',
		);
		for (const call of ratCalls) {
			const data = call[1] as Record<string, { evidenceQuote?: string }>;
			expect(data.metadata?.evidenceQuote).toContain('[MASKED]');
		}
	});

	it('deduplicates rationale nodes when cosine > 0.92', async () => {
		const existingNode = {
			id: 'existing-rationale',
			name: 'weak tokenomics',
			type: 'rationale',
			similarity: 1.0, // DB-computed similarity (identical = 1.0)
		};
		mockSearchKnowledgeNodes.mockResolvedValue([existingNode]);
		mockCreateKnowledgeNode.mockResolvedValueOnce({ id: 'decision-1' });

		await extractDecisionRationales(baseContext, messages);

		// Only decision node created (rationales reused via dedup)
		expect(mockCreateKnowledgeNode).toHaveBeenCalledTimes(1);
		expect(mockIncrementNodeMentionCount).toHaveBeenCalledWith(WS, 'existing-rationale');
	});

	it('caps entity names at 100 chars (SEC-PROV-015 / SEC-PROV-251)', async () => {
		const longEntityName = 'a'.repeat(101);
		mockInferWithGemini.mockResolvedValue(
			geminiJsonResponse([
				{
					...sampleRationales[0],
					relatedEntities: [longEntityName, 'tokenomics'],
				},
			]),
		);
		mockCreateKnowledgeNode
			.mockResolvedValueOnce({ id: 'decision-1' })
			.mockResolvedValueOnce({ id: 'rationale-1' });
		mockFindNodeByNameAnyType.mockResolvedValue({ id: 'entity-1', name: 'tokenomics' });

		await extractDecisionRationales(baseContext, messages);

		// Only 'tokenomics' should be looked up, not the 101-char name
		expect(mockFindNodeByNameAnyType).toHaveBeenCalledTimes(1);
		expect(mockFindNodeByNameAnyType).toHaveBeenCalledWith(WS, 'tokenomics', testEnvelope);
	});

	it('handles invalid JSON response gracefully', async () => {
		mockInferWithGemini.mockResolvedValue('No rationales found.');

		await expect(extractDecisionRationales(baseContext, messages)).resolves.toBeUndefined();
		expect(mockCreateKnowledgeNode).not.toHaveBeenCalled();
	});

	it('continues processing when one rationale fails', async () => {
		mockCreateKnowledgeNode
			.mockResolvedValueOnce({ id: 'decision-1' })
			.mockRejectedValueOnce(new Error('DB error'))
			.mockResolvedValueOnce({ id: 'rationale-2' });

		await expect(extractDecisionRationales(baseContext, messages)).resolves.toBeUndefined();

		// Decision + 2 attempts (1 failed, 1 succeeded)
		expect(mockCreateKnowledgeNode).toHaveBeenCalledTimes(3);
	});

	it('skips contact link when contactId is undefined', async () => {
		const noContactCtx = { ...baseContext, contactId: undefined };
		mockCreateKnowledgeNode.mockResolvedValueOnce({ id: 'decision-1' });

		await extractDecisionRationales(noContactCtx, messages);

		expect(mockLinkContactToKnowledge).not.toHaveBeenCalled();
	});
});
