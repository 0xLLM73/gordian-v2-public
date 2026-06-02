import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
	headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock('@/lib/auth', () => ({
	auth: {
		api: {
			getSession: vi.fn(() =>
				Promise.resolve({
					user: { id: 'user-1', email: 'test@test.com', name: 'Test' },
					session: { id: 'session-1' },
				}),
			),
		},
	},
}));

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';

vi.mock('@/lib/workspace', () => ({
	getUserWorkspaceId: vi.fn(() => Promise.resolve(WORKSPACE_ID)),
	getWorkspaceEnvelope: vi.fn(() =>
		Promise.resolve({
			encryptedWrk: Buffer.from('mock'),
			kmsContext: { WorkspaceID: 'mock' },
			wrkVersion: 1,
		}),
	),
}));

const mockUnifiedSearch = vi.fn(() =>
	Promise.resolve({
		contacts: [{ id: 'c1', firstName: 'John' }] as Array<Record<string, unknown>>,
		memories: [] as Array<{ id: string; content: string; category: string; rrf_score: number }>,
		commitments: [{ id: 'cm1', title: 'Follow up with John' }] as Array<Record<string, unknown>>,
		deals: [] as Array<Record<string, unknown>>,
	}),
);
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@repo/db', () => ({
	withWorkspaceRLS: vi.fn((_wsId: string, fn: (tx: unknown) => unknown) => fn({})),
	unifiedSearch: mockUnifiedSearch,
	trackBehavior: vi.fn().mockResolvedValue(null),
}));

vi.mock('@repo/crypto', () => ({
	unwrapWrk: vi.fn(() => Promise.resolve(Buffer.from('workspace-key'))),
	deriveKeys: vi.fn(() => Promise.resolve({ bik: Buffer.from('blind-index-key') })),
	prefilterEntities: vi.fn(() => [
		{ text: 'alice@example.com', type: 'EMAIL', start: 15, end: 32 },
	]),
	maskEntities: vi.fn((text: string) => ({
		maskedText: text.replace('alice@example.com', '[EMAIL_1]'),
	})),
}));

describe('search actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
		vi.stubEnv('AI_SEARCH_EMBEDDINGS_ENABLED', 'false');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'openai');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_BASE_URL', '');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', '');
		vi.stubEnv('WORKER_URL', 'http://localhost:3001');
		vi.stubEnv('WORKER_INTERNAL_SECRET', 'test-secret');
	});

	describe('searchAction', () => {
		it('calls unifiedSearch with correct params', async () => {
			const { searchAction } = await import('@/app/actions/search');
			const result = await searchAction({
				query: 'John',
			});
			expect(result?.data).toBeDefined();
			expect(result?.data?.contacts).toHaveLength(1);
			expect(result?.data?.commitments).toHaveLength(1);
			expect(mockUnifiedSearch).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'John',
				expect.any(Object),
				null, // short query = no embedding
			);
		});

		it('returns empty results when nothing matches', async () => {
			mockUnifiedSearch.mockResolvedValueOnce({
				contacts: [],
				memories: [],
				commitments: [],
				deals: [],
			});

			const { searchAction } = await import('@/app/actions/search');
			const result = await searchAction({
				query: 'nonexistent',
			});
			expect(result?.data?.contacts).toHaveLength(0);
			expect(result?.data?.memories).toHaveLength(0);
			expect(result?.data?.deals).toHaveLength(0);
		});

		it('rejects empty query', async () => {
			const { searchAction } = await import('@/app/actions/search');
			const result = await searchAction({
				query: '',
			});
			expect(result?.validationErrors).toBeDefined();
		});

		it('searches across all entity types', async () => {
			mockUnifiedSearch.mockResolvedValueOnce({
				contacts: [{ id: 'c1', firstName: 'Alice' }],
				memories: [
					{ id: 'm1', content: 'meeting notes', category: 'conversation', rrf_score: 0.8 },
				],
				commitments: [{ id: 'cm1', title: 'Review meeting notes' }],
				deals: [{ id: 'd1' }],
			});

			const { searchAction } = await import('@/app/actions/search');
			const result = await searchAction({
				query: 'meeting notes about project',
			});
			expect(result?.data?.contacts).toHaveLength(1);
			expect(result?.data?.memories).toHaveLength(1);
			expect(result?.data?.commitments).toHaveLength(1);
			expect(result?.data?.deals).toHaveLength(1);
		});

		it('does not embed long queries unless semantic search egress is explicitly enabled', async () => {
			const { searchAction } = await import('@/app/actions/search');
			await searchAction({
				query: 'meeting notes about project',
			});

			expect(mockFetch).not.toHaveBeenCalled();
			expect(mockUnifiedSearch).toHaveBeenCalledWith(
				WORKSPACE_ID,
				expect.any(String),
				expect.any(Object),
				null,
			);
		});

		it('requires the global AI egress gate for cloud search embeddings', async () => {
			vi.stubEnv('NODE_ENV', 'development');
			vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
			vi.stubEnv('AI_SEARCH_EMBEDDINGS_ENABLED', 'true');

			const { searchAction } = await import('@/app/actions/search');
			await searchAction({
				query: 'meeting notes about project',
			});

			expect(mockFetch).not.toHaveBeenCalled();
			expect(mockUnifiedSearch).toHaveBeenCalledWith(
				WORKSPACE_ID,
				expect.any(String),
				expect.any(Object),
				null,
			);
		});

		it('allows local search embeddings without enabling vendor egress', async () => {
			vi.stubEnv('NODE_ENV', 'development');
			vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
			vi.stubEnv('AI_SEARCH_EMBEDDINGS_ENABLED', 'true');
			vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
			vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'qwen');
			vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'qwen3-embedding:0.6b');
			vi.stubEnv('KNOWLEDGE_EMBEDDING_BASE_URL', 'http://localhost:11434/v1');
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
			});

			const { searchAction } = await import('@/app/actions/search');
			await searchAction({
				query: 'follow up with alice@example.com about the deal',
			});

			expect(mockFetch).toHaveBeenCalledOnce();
			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.text).toContain('[EMAIL_1]');
			expect(mockUnifiedSearch).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'follow up with alice@example.com about the deal',
				expect.any(Object),
				[0.1, 0.2, 0.3],
			);
		});

		it('masks long search queries before embedding when semantic search egress is enabled', async () => {
			vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
			vi.stubEnv('AI_SEARCH_EMBEDDINGS_ENABLED', 'true');
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
			});

			const { searchAction } = await import('@/app/actions/search');
			await searchAction({
				query: 'follow up with alice@example.com about the deal',
			});

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.text).toContain('[EMAIL_1]');
			expect(body.text).not.toContain('alice@example.com');
			expect(mockUnifiedSearch).toHaveBeenCalledWith(
				WORKSPACE_ID,
				'follow up with alice@example.com about the deal',
				expect.any(Object),
				[0.1, 0.2, 0.3],
			);
		});
	});
});
