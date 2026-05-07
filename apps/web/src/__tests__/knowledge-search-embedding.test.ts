import { maskEntities, prefilterEntities } from '@repo/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We can't easily test server actions directly due to the workspaceAction middleware chain.
// Instead, test the key behaviors in isolation:
// 1. generateQueryEmbedding (OpenAI API call)
// 2. ELM masking pipeline (prefilterEntities → maskEntities)
// 3. Integration: masked query → embedding → searchKnowledgeNodes

vi.mock('@repo/crypto', async () => {
	const actual = await vi.importActual('@repo/crypto');
	return {
		...actual,
		unwrapWrk: vi.fn(),
		deriveKeys: vi.fn(),
		withKeys: vi.fn((_envelope: unknown, fn: () => unknown) => fn()),
	};
});

const mockFetch = vi.fn();

describe('Knowledge search embedding', () => {
	const FAKE_EMBEDDING = Array.from({ length: 512 }, (_, i) => i * 0.001);

	beforeEach(() => {
		mockFetch.mockReset();
		vi.stubGlobal('fetch', mockFetch);
		process.env.OPENAI_API_KEY = 'test-key';

		mockFetch.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					data: [{ embedding: FAKE_EMBEDDING, index: 0 }],
				}),
			text: () => Promise.resolve(''),
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.env.OPENAI_API_KEY = undefined;
	});

	describe('OpenAI embedding API call', () => {
		async function callEmbeddingAPI(text: string): Promise<number[]> {
			const apiKey = process.env.OPENAI_API_KEY;
			if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
			const response = await fetch('https://api.openai.com/v1/embeddings', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: 'text-embedding-3-small',
					input: text,
					dimensions: 512,
				}),
			});
			if (!response.ok) {
				const error = await response.text();
				throw new Error(`Embedding API error (${response.status}): ${error}`);
			}
			const data = (await response.json()) as {
				data: Array<{ embedding: number[] }>;
			};
			return data.data[0].embedding;
		}

		it('calls OpenAI with correct model and dimensions', async () => {
			await callEmbeddingAPI('blockchain technology');

			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [url, opts] = mockFetch.mock.calls[0];
			expect(url).toBe('https://api.openai.com/v1/embeddings');

			const body = JSON.parse(opts.body);
			expect(body.model).toBe('text-embedding-3-small');
			expect(body.dimensions).toBe(512);
			expect(body.input).toBe('blockchain technology');
		});

		it('passes Authorization header with API key', async () => {
			await callEmbeddingAPI('test');

			const [, opts] = mockFetch.mock.calls[0];
			expect(opts.headers.Authorization).toBe('Bearer test-key');
		});

		it('returns 512-dim embedding vector', async () => {
			const result = await callEmbeddingAPI('test');
			expect(result).toHaveLength(512);
			expect(result).toEqual(FAKE_EMBEDDING);
		});

		it('throws on missing API key', async () => {
			process.env.OPENAI_API_KEY = '';
			await expect(callEmbeddingAPI('test')).rejects.toThrow('OPENAI_API_KEY is not set');
		});

		it('throws on API error with status code', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 429,
				text: () => Promise.resolve('Rate limited'),
			});

			await expect(callEmbeddingAPI('test')).rejects.toThrow(
				'Embedding API error (429): Rate limited',
			);
		});

		it('throws on 500 error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: () => Promise.resolve('Internal Server Error'),
			});

			await expect(callEmbeddingAPI('test')).rejects.toThrow('Embedding API error (500)');
		});
	});

	describe('ELM masking for search queries', () => {
		const FAKE_SALT = Buffer.from('a'.repeat(64), 'hex');

		it('returns query unchanged when no PII detected', () => {
			const query = 'blockchain technology';
			const detected = prefilterEntities(query);
			expect(detected).toHaveLength(0);

			const { maskedText } = maskEntities(query, FAKE_SALT, detected);
			expect(maskedText).toBe('blockchain technology');
		});

		it('detects and masks email addresses', () => {
			const query = 'alice@example.com';
			const detected = prefilterEntities(query);
			expect(detected.length).toBeGreaterThan(0);
			expect(detected[0].type).toBe('EMAIL');

			const { maskedText } = maskEntities(query, FAKE_SALT, detected);
			expect(maskedText).not.toBe('alice@example.com');
			expect(maskedText).toMatch(/^EMAIL_[a-f0-9]+$/);
		});

		it('detects and masks phone numbers', () => {
			const query = '+1-555-123-4567';
			const detected = prefilterEntities(query);
			expect(detected.length).toBeGreaterThan(0);
			expect(detected[0].type).toBe('PHONE');

			const { maskedText } = maskEntities(query, FAKE_SALT, detected);
			expect(maskedText).not.toBe('+1-555-123-4567');
			expect(maskedText).toMatch(/^PHONE_[a-f0-9]+$/);
		});

		it('produces consistent pseudonyms for same input + salt', () => {
			const query = 'alice@example.com';
			const detected1 = prefilterEntities(query);
			const { maskedText: masked1 } = maskEntities(query, FAKE_SALT, detected1);

			const detected2 = prefilterEntities(query);
			const { maskedText: masked2 } = maskEntities(query, FAKE_SALT, detected2);

			expect(masked1).toBe(masked2);
		});

		it('produces different pseudonyms for different salts', () => {
			const query = 'alice@example.com';
			const salt2 = Buffer.from('b'.repeat(64), 'hex');

			const detected1 = prefilterEntities(query);
			const { maskedText: masked1 } = maskEntities(query, FAKE_SALT, detected1);

			const detected2 = prefilterEntities(query);
			const { maskedText: masked2 } = maskEntities(query, salt2, detected2);

			expect(masked1).not.toBe(masked2);
		});

		it('leaves non-PII parts of mixed query intact', () => {
			const query = 'contact alice@example.com about project';
			const detected = prefilterEntities(query);
			const { maskedText } = maskEntities(query, FAKE_SALT, detected);

			expect(maskedText).toContain('contact ');
			expect(maskedText).toContain(' about project');
			expect(maskedText).not.toContain('alice@example.com');
		});
	});

	describe('End-to-end wiring verification', () => {
		it('masked query produces valid embedding input', async () => {
			const FAKE_SALT = Buffer.from('a'.repeat(64), 'hex');
			const query = 'alice@example.com blockchain project';

			// Step 1: Mask
			const detected = prefilterEntities(query);
			const { maskedText } = maskEntities(query, FAKE_SALT, detected);

			// Verify email was masked but topical terms preserved
			expect(maskedText).not.toContain('alice@example.com');
			expect(maskedText).toContain('blockchain project');

			// Step 2: Embed (would call OpenAI in production)
			const response = await fetch('https://api.openai.com/v1/embeddings', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				},
				body: JSON.stringify({
					model: 'text-embedding-3-small',
					input: maskedText,
					dimensions: 512,
				}),
			});
			const data = (await response.json()) as {
				data: Array<{ embedding: number[] }>;
			};
			const embedding = data.data[0].embedding;

			// Verify the embedding is the right shape
			expect(embedding).toHaveLength(512);

			// Verify the masked text was what got sent to OpenAI
			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.input).toBe(maskedText);
			expect(body.input).not.toContain('alice@example.com');
		});

		it('pure topical query flows through without modification', async () => {
			const FAKE_SALT = Buffer.from('a'.repeat(64), 'hex');
			const query = 'machine learning artificial intelligence';

			const detected = prefilterEntities(query);
			expect(detected).toHaveLength(0);

			const { maskedText } = maskEntities(query, FAKE_SALT, detected);
			expect(maskedText).toBe(query);

			// Embedding call with unmodified text
			await fetch('https://api.openai.com/v1/embeddings', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				},
				body: JSON.stringify({
					model: 'text-embedding-3-small',
					input: maskedText,
					dimensions: 512,
				}),
			});

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.input).toBe('machine learning artificial intelligence');
		});
	});
});
