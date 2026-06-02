import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetOpenAIApiKey = vi.hoisted(() => vi.fn());

vi.mock('@repo/crypto/local-secrets', () => ({
	getOpenAIApiKey: mockGetOpenAIApiKey,
}));

import {
	assertSafeEmbeddingInputs,
	clearEmbeddingCache,
	generateEmbeddingCached,
	generateEmbeddings,
	generateEmbeddingsCached,
} from '../embeddings';

describe('OpenAI embeddings', () => {
	const fetchMock = vi.fn();

	function makeEmbedding(seed: number): number[] {
		return Array.from({ length: 512 }, (_, index) => (seed + index) / 1000);
	}

	function fetchBody(callIndex = 0): { input: string[]; model?: string; dimensions?: number } {
		const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
		return JSON.parse(String(init?.body)) as { input: string[] };
	}

	beforeEach(() => {
		vi.clearAllMocks();
		clearEmbeddingCache();
		vi.stubGlobal('fetch', fetchMock);
		vi.unstubAllEnvs();
		mockGetOpenAIApiKey.mockResolvedValue('sk-keychain-or-env');
		fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as { input: string[] };
			return {
				ok: true,
				json: () =>
					Promise.resolve({
						data: body.input.map((_text, index) => ({
							embedding: makeEmbedding(index),
							index,
						})),
					}),
			};
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('uses the resolved server-side OpenAI API key', async () => {
		await generateEmbeddings(['masked text']);

		expect(mockGetOpenAIApiKey).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.openai.com/v1/embeddings',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer sk-keychain-or-env',
				}),
			}),
		);
	});

	it('fails closed when no OpenAI API key is configured', async () => {
		mockGetOpenAIApiKey.mockResolvedValue(undefined);

		await expect(generateEmbeddings(['masked text'])).rejects.toThrow(
			/OpenAI API key is not configured/,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('fails closed when cloud AI processing is not explicitly enabled outside tests', async () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');

		await expect(generateEmbeddings(['masked text'])).rejects.toThrow(/AI_PROCESSING_ENABLED=true/);
		expect(mockGetOpenAIApiKey).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('embeds identical sanitized text once and reuses the cached value', async () => {
		const results = await generateEmbeddingsCached(['masked text', 'masked text']);
		const cachedResult = await generateEmbeddingCached('masked text');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchBody().input).toEqual(['masked text']);
		expect(results).toHaveLength(2);
		expect(results.map((result) => result.index)).toEqual([0, 1]);
		expect(results[0].embedding).toEqual(results[1].embedding);
		expect(cachedResult).toEqual(results[0].embedding);
	});

	it('keeps array inputs batched into one OpenAI request', async () => {
		const results = await generateEmbeddingsCached(['masked one', 'masked two']);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchBody().input).toEqual(['masked one', 'masked two']);
		expect(results.map((result) => result.index)).toEqual([0, 1]);
		expect(results[0].embedding).toEqual(makeEmbedding(0));
		expect(results[1].embedding).toEqual(makeEmbedding(1));
	});

	it('rejects raw email inputs before calling the embedding endpoint', async () => {
		await expect(generateEmbeddings(['Contact alice@example.com about DePIN'])).rejects.toThrow(
			/raw email address/,
		);
		expect(mockGetOpenAIApiKey).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects raw Telegram handles before cached embedding requests', async () => {
		await expect(generateEmbeddingCached('Ask @alice_dev about the intro')).rejects.toThrow(
			/raw Telegram handle/,
		);
		expect(mockGetOpenAIApiKey).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('allows entity-masked embedding inputs', () => {
		expect(() =>
			assertSafeEmbeddingInputs(['PERSON_a1b2c3d4 introduced EMAIL_11223344 to ADDRESS_55667788']),
		).not.toThrow();
	});

	it('uses a local OpenAI-compatible embedding endpoint without requiring an OpenAI key', async () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_BASE_URL', 'http://localhost:11434/v1');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'local-512');
		mockGetOpenAIApiKey.mockResolvedValue(undefined);

		await generateEmbeddings(['masked local text']);

		expect(mockGetOpenAIApiKey).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:11434/v1/embeddings',
			expect.objectContaining({
				headers: expect.not.objectContaining({
					Authorization: expect.any(String),
				}),
			}),
		);
		const body = fetchBody();
		expect(body).toMatchObject({
			input: ['masked local text'],
			model: 'local-512',
		});
	});

	it('formats Nomic local query embeddings before calling the endpoint', async () => {
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'nomic');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_BASE_URL', 'http://localhost:11434/v1');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'nomic-embed-text');
		mockGetOpenAIApiKey.mockResolvedValue(undefined);

		await generateEmbeddingCached('who knows about DePIN?', { purpose: 'query' });

		expect(fetchBody().input).toEqual(['search_query: who knows about DePIN?']);
		expect(fetchBody().model).toBe('nomic-embed-text');
		expect(fetchBody().dimensions).toBe(512);
	});

	it('formats Nomic local document embeddings before cache keys are reused', async () => {
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'nomic');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_BASE_URL', 'http://localhost:11434/v1');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'nomic-embed-text');
		mockGetOpenAIApiKey.mockResolvedValue(undefined);

		const results = await generateEmbeddingsCached(['Solana DePIN', 'Solana DePIN'], {
			purpose: 'dedup',
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchBody().input).toEqual(['search_document: Solana DePIN']);
		expect(results[0].embedding).toEqual(results[1].embedding);
	});

	it('formats Qwen local query embeddings with the retrieval instruction', async () => {
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PRESET', 'qwen');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_BASE_URL', 'http://localhost:11434/v1');
		vi.stubEnv('KNOWLEDGE_EMBEDDING_MODEL', 'qwen3-embedding:0.6b');
		mockGetOpenAIApiKey.mockResolvedValue(undefined);

		await generateEmbeddings(['who knows about DePIN?'], { purpose: 'query' });

		expect(fetchBody().input).toEqual([
			'Instruct: Retrieve relevant knowledge graph entities and contacts.\nQuery: who knows about DePIN?',
		]);
		expect(fetchBody().model).toBe('qwen3-embedding:0.6b');
	});

	it('rejects local embeddings that do not match the 512-dim knowledge schema', async () => {
		vi.stubEnv('KNOWLEDGE_EMBEDDING_PROVIDER', 'local');
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					data: [{ embedding: [0.1, 0.2], index: 0 }],
				}),
		});

		await expect(generateEmbeddings(['masked text'])).rejects.toThrow(
			/Embedding dimension mismatch: expected 512, got 2/,
		);
	});
});
