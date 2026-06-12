import { describe, expect, it, vi } from 'vitest';

const mockSearchContactByName = vi.hoisted(() => vi.fn());
const mockGetCommitmentsByContact = vi.hoisted(() => vi.fn());
const mockGetActiveCommitments = vi.hoisted(() => vi.fn());
const mockGetDealsByContact = vi.hoisted(() => vi.fn());
const mockListDeals = vi.hoisted(() => vi.fn());
const mockHybridSearch = vi.hoisted(() => vi.fn());
const mockGetDashboardStats = vi.hoisted(() => vi.fn());
const mockGetHealthScoresByWorkspace = vi.hoisted(() => vi.fn());
const mockGetMessageContactCoverageReport = vi.hoisted(() => vi.fn());
const mockGetMessagesByTimeRange = vi.hoisted(() => vi.fn());
const mockListContacts = vi.hoisted(() => vi.fn());
const mockListKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());
const mockSearchKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockKnowledgeGraphSearch = vi.hoisted(() => vi.fn());
const mockProvenanceSearch = vi.hoisted(() => vi.fn());
const mockFindRelevantPrecedents = vi.hoisted(() => vi.fn());
const mockFormatPrecedents = vi.hoisted(() => vi.fn());
const mockGetContact = vi.hoisted(() => vi.fn());
const mockGetDeal = vi.hoisted(() => vi.fn());
const mockGenerateDraft = vi.hoisted(() => vi.fn());

vi.mock('@repo/db', () => ({
	searchContactByName: mockSearchContactByName,
	getCommitmentsByContact: mockGetCommitmentsByContact,
	getActiveCommitments: mockGetActiveCommitments,
	getDealsByContact: mockGetDealsByContact,
	listDeals: mockListDeals,
	hybridSearch: mockHybridSearch,
	getDashboardStats: mockGetDashboardStats,
	getHealthScoresByWorkspace: mockGetHealthScoresByWorkspace,
	getMessageContactCoverageReport: mockGetMessageContactCoverageReport,
	getMessagesByTimeRange: mockGetMessagesByTimeRange,
	listContacts: mockListContacts,
	listKnowledgeNodes: mockListKnowledgeNodes,
	searchKnowledgeNodes: mockSearchKnowledgeNodes,
	knowledgeGraphSearch: mockKnowledgeGraphSearch,
	provenanceSearch: mockProvenanceSearch,
	getContact: mockGetContact,
	getDeal: mockGetDeal,
}));

vi.mock('../draft-generation', () => ({
	generateDraft: mockGenerateDraft,
}));

vi.mock('../embeddings', () => ({
	generateEmbedding: mockGenerateEmbedding,
}));

// SEC-102: Mock entity masking used by search_memories
vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: any, fn: () => Promise<any>) => fn()),
	getCurrentKeys: vi.fn(() => ({ bik: Buffer.from('test-bik') })),
	keyStore: { getStore: vi.fn(() => ({ bik: Buffer.from('test-bik') })) },
	maskEntities: vi.fn((text: string) => ({ maskedText: text, entityMap: [] })),
}));

vi.mock('../prefilter', () => ({
	prefilterEntities: mockPrefilterEntities,
}));

vi.mock('../precedents', () => ({
	findRelevantPrecedents: mockFindRelevantPrecedents,
	formatPrecedents: mockFormatPrecedents,
}));

import { CHAT_TOOLS, TOOL_EXECUTORS } from '../chat-tools';

const fakeEnvelope = {
	encryptedWrk: Buffer.from('fake'),
	kmsContext: {},
	wrkVersion: 1,
};

describe('CHAT_TOOLS', () => {
	it('defines 16 tools with valid names and input_schema', () => {
		expect(CHAT_TOOLS).toHaveLength(16);
		const names = CHAT_TOOLS.map((t) => t.name);
		expect(names).toContain('get_workspace_context');
		expect(names).toContain('list_knowledge_topics');
		expect(names).toContain('search_contacts');
		expect(names).toContain('get_commitments');
		expect(names).toContain('get_deals');
		expect(names).toContain('search_memories');
		expect(names).toContain('search_knowledge');
		expect(names).toContain('search_imported_messages');
		expect(names).toContain('search_precedents');
		expect(names).toContain('create_commitment');
		expect(names).toContain('update_deal_stage');
		expect(names).toContain('draft_message');
		expect(names).toContain('get_contact_health');
		expect(names).toContain('create_deal');
		expect(names).toContain('create_goal');

		for (const tool of CHAT_TOOLS) {
			expect(tool.name).toBeTruthy();
			expect(tool.input_schema).toBeDefined();
			expect(tool.input_schema.type).toBe('object');
		}
	});

	it('TOOL_EXECUTORS has an entry for every tool in CHAT_TOOLS', () => {
		for (const tool of CHAT_TOOLS) {
			expect(TOOL_EXECUTORS[tool.name]).toBeDefined();
			expect(typeof TOOL_EXECUTORS[tool.name]).toBe('function');
		}
	});

	it('search_contacts executor returns "No contacts found." when DAL returns empty array', async () => {
		mockSearchContactByName.mockResolvedValue([]);

		const result = await TOOL_EXECUTORS.search_contacts({ name: 'Alice' }, 'ws-1', fakeEnvelope);

		expect(result).toBe('No contacts found.');
		expect(mockSearchContactByName).toHaveBeenCalledWith('ws-1', 'Alice', fakeEnvelope);
	});

	it('get_commitments executor passes workspaceId to DAL', async () => {
		mockGetActiveCommitments.mockResolvedValue([]);

		await TOOL_EXECUTORS.get_commitments({}, 'ws-2', fakeEnvelope);

		expect(mockGetActiveCommitments).toHaveBeenCalledWith('ws-2', fakeEnvelope, { limit: 20 });
	});

	it('get_commitments executor filters by contact_id when provided', async () => {
		mockGetCommitmentsByContact.mockResolvedValue([]);

		await TOOL_EXECUTORS.get_commitments({ contact_id: 'contact-abc' }, 'ws-3', fakeEnvelope);

		expect(mockGetCommitmentsByContact).toHaveBeenCalledWith('ws-3', 'contact-abc', fakeEnvelope, {
			limit: 20,
		});
	});

	it('get_deals executor returns "No deals found." when DAL returns empty array', async () => {
		mockListDeals.mockResolvedValue([]);

		const result = await TOOL_EXECUTORS.get_deals({}, 'ws-4', fakeEnvelope);

		expect(result).toBe('No deals found.');
	});

	it('get_workspace_context returns safe local summaries without raw message text or internal ids', async () => {
		mockGetDashboardStats.mockResolvedValue({
			contactCount: 2,
			activeCommitmentCount: 1,
			openDealCount: 1,
			totalDealValue: 1000,
			activeGoalCount: 1,
		});
		mockListContacts.mockResolvedValue([
			{
				id: 'contact-1',
				firstName: 'Alice',
				lastName: 'Example',
				username: null,
				messageCount: 12,
				lastMessageAt: new Date('2026-06-10T12:00:00Z'),
			},
		]);
		mockListDeals.mockResolvedValue([
			{
				id: 'deal-1',
				contactId: 'contact-1',
				title: 'Seed round',
				stage: 'diligence',
				value: 1000,
				workspaceId: 'ws-ctx',
			},
		]);
		mockGetActiveCommitments.mockResolvedValue([
			{
				id: 'commitment-1',
				contactId: 'contact-1',
				title: 'Follow up',
				status: 'active',
				workspaceId: 'ws-ctx',
			},
		]);
		mockGetHealthScoresByWorkspace.mockResolvedValue([
			{ contactId: 'contact-1', label: 'healthy', trend: 'stable', composite: 0.82 },
		]);
		mockGetMessageContactCoverageReport.mockResolvedValue({
			totalMessages: 25,
			linkedContactMessages: 20,
			messagesWithSenderMetadata: 22,
			chatsWithNullContactMessages: 1,
			byChatType: [{ chatType: 'private', totalMessages: 25, linkedContactMessages: 20 }],
		});
		mockListKnowledgeNodes.mockResolvedValue([
			{
				id: 'node-1',
				displayName: 'Solana',
				type: 'technology',
				description: 'Layer 1 blockchain',
				mentionCount: 4,
				lastSeenAt: new Date('2026-06-10T12:00:00Z'),
				reviewStatus: 'unreviewed',
			},
		]);

		const result = await TOOL_EXECUTORS.get_workspace_context({}, 'ws-ctx', fakeEnvelope);
		const parsed = JSON.parse(result) as {
			counts: { importedMessages: number };
			topContacts: Array<{ name: string }>;
			openDeals: Array<Record<string, unknown>>;
			topKnowledgeTopics: Array<{ name: string }>;
		};

		expect(parsed.counts.importedMessages).toBe(25);
		expect(parsed.topContacts[0]?.name).toBe('Alice Example');
		expect(parsed.topKnowledgeTopics[0]?.name).toBe('Solana');
		expect(JSON.stringify(parsed.openDeals)).not.toContain('deal-1');
		expect(result).not.toContain('raw private message');
	});

	it('list_knowledge_topics returns top generated nodes for broad theme questions', async () => {
		mockListKnowledgeNodes.mockResolvedValue([
			{
				displayName: 'AI Infrastructure',
				type: 'sector',
				description: 'Infrastructure for AI development',
				mentionCount: 3,
				lastSeenAt: null,
				reviewStatus: 'unreviewed',
			},
		]);

		const result = await TOOL_EXECUTORS.list_knowledge_topics(
			{ limit: 5 },
			'ws-topics',
			fakeEnvelope,
		);

		expect(mockListKnowledgeNodes).toHaveBeenCalledWith(
			'ws-topics',
			{ limit: 5, type: undefined },
			fakeEnvelope,
		);
		expect(result).toContain('AI Infrastructure');
	});

	it('search_knowledge executor uses provenanceSearch then falls back to text search', async () => {
		const rootNode = { id: 'node-1', displayName: 'Ethereum', type: 'topic', name: 'ethereum' };
		const graphNode = { id: 'node-2', displayName: 'DeFi', type: 'sector', name: 'defi' };

		// Provenance returns empty → triggers fallback
		mockProvenanceSearch.mockResolvedValue([]);
		mockGenerateEmbedding.mockResolvedValue([0.1]);
		mockPrefilterEntities.mockReturnValue([]);
		mockSearchKnowledgeNodes.mockResolvedValue([rootNode]);
		mockKnowledgeGraphSearch.mockResolvedValue([{ node: graphNode, depth: 1 }]);

		const result = await TOOL_EXECUTORS.search_knowledge(
			{ query: 'ethereum' },
			'ws-6',
			fakeEnvelope,
		);

		expect(mockProvenanceSearch).toHaveBeenCalledWith('ws-6', [0.1], {
			envelope: fakeEnvelope,
			maxHops: 3,
			limit: 10,
		});
		expect(mockSearchKnowledgeNodes).toHaveBeenCalledWith(
			'ws-6',
			'ethereum',
			undefined,
			fakeEnvelope,
		);
		expect(result).toContain('Ethereum');
	});

	it('search_knowledge executor returns provenance results when available', async () => {
		mockSearchKnowledgeNodes.mockClear();
		mockGenerateEmbedding.mockResolvedValue([0.1]);
		mockPrefilterEntities.mockReturnValue([]);
		mockProvenanceSearch.mockResolvedValue([
			{
				nodeId: 'n-1',
				nodeType: 'decision',
				displayName: 'deal_lost — Weak tokenomics',
				description: null,
				depth: 0,
				provenanceScore: 0.9,
				decisionAction: 'deal_lost',
			},
		]);

		const result = await TOOL_EXECUTORS.search_knowledge(
			{ query: 'tokenomics' },
			'ws-6',
			fakeEnvelope,
		);

		expect(result).toContain('Provenance search results');
		expect(result).toContain('deal_lost');
		expect(mockSearchKnowledgeNodes).not.toHaveBeenCalled();
	});

	it('search_knowledge executor returns "No knowledge nodes found." when both searches empty', async () => {
		mockProvenanceSearch.mockResolvedValue([]);
		mockGenerateEmbedding.mockResolvedValue([0.1]);
		mockPrefilterEntities.mockReturnValue([]);
		mockSearchKnowledgeNodes.mockResolvedValue([]);
		mockKnowledgeGraphSearch.mockReset();

		const result = await TOOL_EXECUTORS.search_knowledge(
			{ query: 'unknown' },
			'ws-6',
			fakeEnvelope,
		);

		expect(result).toContain('No knowledge');
		expect(mockKnowledgeGraphSearch).not.toHaveBeenCalled();
	});

	it('search_memories masks query before embedding (SEC-102)', async () => {
		const fakeEmbedding = [0.1, 0.2, 0.3];
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockHybridSearch.mockResolvedValue([]);
		mockPrefilterEntities.mockReturnValue([]);

		await TOOL_EXECUTORS.search_memories({ query: 'funding round' }, 'ws-5', fakeEnvelope);

		// Embedding should be called with the masked text (identity in this mock)
		expect(mockGenerateEmbedding).toHaveBeenCalledWith('funding round');
		// Raw query still used for keyword search component
		expect(mockHybridSearch).toHaveBeenCalledWith('ws-5', fakeEmbedding, 'funding round', {
			limit: 10,
		});
		// Prefilter should have been called on the query
		expect(mockPrefilterEntities).toHaveBeenCalledWith('funding round');
	});

	it('search_imported_messages returns only masked snippets for local message matches', async () => {
		mockGetMessagesByTimeRange.mockResolvedValue([
			{
				text: 'Alice wants to discuss Solana validator infrastructure next week.',
				isOutgoing: false,
				sentAt: new Date('2026-06-10T12:00:00Z'),
			},
			{
				text: 'Unrelated local message',
				isOutgoing: true,
				sentAt: new Date('2026-06-09T12:00:00Z'),
			},
		]);

		const result = await TOOL_EXECUTORS.search_imported_messages(
			{ query: 'Solana', days: 30, limit: 3 },
			'ws-msg',
			fakeEnvelope,
		);

		expect(mockGetMessagesByTimeRange).toHaveBeenCalledWith(
			'ws-msg',
			expect.any(Date),
			expect.any(Date),
			fakeEnvelope,
			expect.objectContaining({ limit: 500, order: 'desc' }),
		);
		expect(result).toContain('maskedSnippet');
		expect(result).toContain('Solana validator infrastructure');
		expect(result).not.toContain('Unrelated local message');
	});

	it('search_precedents executor returns formatted precedents with graph context', async () => {
		const fakePrecedents = [
			{
				type: 'deal_closed',
				result: 'negative',
				contextLabels: ['deal_type:equity', 'stage:lost', 'value_range:sub_10k'],
				occurredAt: new Date('2026-01-15'),
			},
		];
		mockFindRelevantPrecedents.mockResolvedValue(fakePrecedents);
		mockFormatPrecedents.mockReturnValue(
			'- [deal_closed] NEGATIVE — deal_type:equity (Jan 15, 2026)',
		);
		mockProvenanceSearch.mockResolvedValue([]);
		mockGenerateEmbedding.mockResolvedValue([0.1]);
		mockPrefilterEntities.mockReturnValue([]);

		const result = await TOOL_EXECUTORS.search_precedents(
			{ query: 'deal lost small value equity' },
			'ws-7',
			fakeEnvelope,
		);

		expect(mockFindRelevantPrecedents).toHaveBeenCalledWith(
			'ws-7',
			'deal lost small value equity',
			fakeEnvelope,
		);
		expect(mockFormatPrecedents).toHaveBeenCalledWith(fakePrecedents);
		expect(result).toContain('[deal_closed] NEGATIVE');
	});

	it('search_precedents executor returns fallback when no precedents found', async () => {
		mockFindRelevantPrecedents.mockResolvedValue([]);
		mockFormatPrecedents.mockClear();
		mockProvenanceSearch.mockResolvedValue([]);
		mockGenerateEmbedding.mockResolvedValue([0.1]);
		mockPrefilterEntities.mockReturnValue([]);

		const result = await TOOL_EXECUTORS.search_precedents(
			{ query: 'commitment missed' },
			'ws-7',
			fakeEnvelope,
		);

		expect(result).toContain('No similar past outcomes found.');
		expect(mockFormatPrecedents).not.toHaveBeenCalled();
	});
});
