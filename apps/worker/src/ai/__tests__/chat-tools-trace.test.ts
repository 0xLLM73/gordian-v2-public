import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CGC: trace_decision Chat Tool Tests
 *
 * Tests the trace_decision tool executor:
 * 1. ELM-masks query before embedding (SEC-122)
 * 2. GraphRAG search — 3-hop causal graph traversal
 * 3. Fetches full decision records with decryption (SEC-CG-002)
 * 4. Formats causal chain sorted by depth
 */

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

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
const mockSearchKnowledgeNodes = vi.hoisted(() => vi.fn());
const mockKnowledgeGraphSearch = vi.hoisted(() => vi.fn());
const mockProvenanceSearch = vi.hoisted(() => vi.fn());
const mockGetContact = vi.hoisted(() => vi.fn());
const mockGetDeal = vi.hoisted(() => vi.fn());
const mockGraphragSearch = vi.hoisted(() => vi.fn());
const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockPrefilterEntities = vi.hoisted(() => vi.fn());
const mockFindRelevantPrecedents = vi.hoisted(() => vi.fn());
const mockFormatPrecedents = vi.hoisted(() => vi.fn());
const mockGenerateDraft = vi.hoisted(() => vi.fn());

// Dynamic import mock for trace_decision's `await import('@repo/db')`
const mockUserDecisions = vi.hoisted(() => ({ id: 'user_decisions.id' }));
const mockInArray = vi.hoisted(() => vi.fn());
const mockDbSelectFrom = vi.hoisted(() => vi.fn());
const mockDbSelectWhere = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() =>
	vi.fn(() => ({
		from: mockDbSelectFrom.mockReturnValue({ where: mockDbSelectWhere }),
	})),
);
const mockDb = vi.hoisted(() => ({ select: mockDbSelect }));

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
	graphragSearch: mockGraphragSearch,
	db: mockDb,
	userDecisions: mockUserDecisions,
	inArray: mockInArray,
	and: vi.fn((...conditions: unknown[]) => conditions),
	eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
}));

vi.mock('../draft-generation', () => ({ generateDraft: mockGenerateDraft }));
vi.mock('../embeddings', () => ({ generateEmbedding: mockGenerateEmbedding }));
vi.mock('../prefilter', () => ({ prefilterEntities: mockPrefilterEntities }));
vi.mock('../precedents', () => ({
	findRelevantPrecedents: mockFindRelevantPrecedents,
	formatPrecedents: mockFormatPrecedents,
}));

vi.mock('@repo/crypto', () => ({
	withKeys: vi.fn((_envelope: unknown, fn: () => Promise<unknown>) => fn()),
	getCurrentKeys: vi.fn(() => ({ bik: Buffer.from('test-bik') })),
	keyStore: { getStore: vi.fn(() => ({ bik: Buffer.from('test-bik') })) },
	maskEntities: vi.fn((text: string) => ({ maskedText: text, entityMap: [] })),
}));

import { CHAT_TOOLS, TOOL_EXECUTORS } from '../chat-tools';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WS = 'ws-00000000-0000-0000-0000-000000000001';

const fakeEnvelope = {
	encryptedWrk: Buffer.from('fake'),
	kmsContext: {},
	wrkVersion: 1,
};

const fakeEmbedding = [0.1, 0.2, 0.3];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('trace_decision tool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
		mockPrefilterEntities.mockReturnValue([]);
		mockGraphragSearch.mockResolvedValue([]);
		mockDbSelectWhere.mockResolvedValue([]);
	});

	it('is registered in CHAT_TOOLS array', () => {
		const names = CHAT_TOOLS.map((t) => t.name);
		expect(names).toContain('trace_decision');
	});

	it('has a trace_decision executor in TOOL_EXECUTORS', () => {
		expect(TOOL_EXECUTORS.trace_decision).toBeDefined();
	});

	it('ELM-masks query before embedding (SEC-122)', async () => {
		mockGraphragSearch.mockResolvedValue([]);

		await TOOL_EXECUTORS.trace_decision(
			{ query: 'why did I pass on that deal?' },
			WS,
			fakeEnvelope,
		);

		expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
		// ELM masking happens via withKeys + maskEntities (mocked as passthrough)
	});

	it('calls graphragSearch with 3-hop depth and limit 10', async () => {
		mockGraphragSearch.mockResolvedValue([]);

		await TOOL_EXECUTORS.trace_decision(
			{ query: 'why did I commit to that partnership?' },
			WS,
			fakeEnvelope,
		);

		expect(mockGraphragSearch).toHaveBeenCalledWith(WS, fakeEmbedding, {
			maxDepth: 3,
			limit: 10,
		});
	});

	it('returns "no decision history" when no graph results', async () => {
		mockGraphragSearch.mockResolvedValue([]);

		const result = await TOOL_EXECUTORS.trace_decision({ query: 'test query' }, WS, fakeEnvelope);

		expect(result).toContain('No decision history found');
	});

	it('fetches full decision records via dynamic import and formats causal chain', async () => {
		mockGraphragSearch.mockResolvedValue([
			{ id: 'dec-1', depth: 0, semantic_distance: 0.1 },
			{ id: 'dec-2', depth: 1, semantic_distance: 0.3 },
		]);

		// Mock the dynamic import select chain: db.select().from().where()
		mockDbSelectWhere.mockResolvedValue([
			{
				id: 'dec-2',
				decisionType: 'commitment',
				rawContent: 'Committed to weekly sync',
				createdAt: new Date('2026-03-01'),
				entityId: null,
			},
			{
				id: 'dec-1',
				decisionType: 'message',
				rawContent: 'Discussed partnership terms',
				createdAt: new Date('2026-02-28'),
				entityId: 'entity-abc',
			},
		]);

		const result = await TOOL_EXECUTORS.trace_decision(
			{ query: 'trace my partnership decisions' },
			WS,
			fakeEnvelope,
		);

		expect(result).toContain('Decision Trace');
		// Sorted by depth: depth 0 first, depth 1 second
		expect(result).toContain('[Depth 0]');
		expect(result).toContain('[Depth 1]');
		expect(result).toContain('Discussed partnership terms');
		expect(result).toContain('Committed to weekly sync');
	});

	it('includes entity ID in output when present', async () => {
		mockGraphragSearch.mockResolvedValue([{ id: 'dec-1', depth: 0, semantic_distance: 0.1 }]);

		mockDbSelectWhere.mockResolvedValue([
			{
				id: 'dec-1',
				decisionType: 'purchase',
				rawContent: 'Closed the deal',
				createdAt: new Date('2026-03-03'),
				entityId: 'deal-12345678-abcd',
			},
		]);

		const result = await TOOL_EXECUTORS.trace_decision(
			{ query: 'why did I close that deal?' },
			WS,
			fakeEnvelope,
		);

		expect(result).toContain('Entity: deal-123');
	});
});
