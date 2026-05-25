/**
 * Embedding Pipeline (pillar7):
 * Generates KG vector embeddings using cloud OpenAI or a local OpenAI-compatible
 * endpoint via fetch.
 *
 * CRITICAL: Input text MUST be sanitized via Entity-Linked Masking
 * before calling generateEmbeddings(). Embeddings are invertible —
 * Vec2Text recovers 92% of 32-token text. (followup12a)
 */

import { getOpenAIApiKey } from '@repo/crypto/local-secrets';
import {
	type KnowledgeEmbeddingPurpose,
	assertAiProcessingEnabled,
	formatKnowledgeEmbeddingInput,
	getKnowledgeEmbeddingRuntime,
} from '@repo/shared';

export interface EmbeddingResult {
	embedding: number[];
	index: number;
}

export interface EmbeddingCache {
	get(text: string): number[] | undefined;
	set(text: string, embedding: number[]): void;
	clear?(): void;
}

export interface GenerateEmbeddingsCachedOptions {
	cache?: EmbeddingCache;
	purpose?: KnowledgeEmbeddingPurpose;
}

export interface GenerateEmbeddingsOptions {
	purpose?: KnowledgeEmbeddingPurpose;
}

const defaultEmbeddingCache = new Map<string, number[]>();

function cloneEmbedding(embedding: number[]): number[] {
	return [...embedding];
}

function formatEmbeddingInputs(texts: string[], purpose?: KnowledgeEmbeddingPurpose): string[] {
	if (!purpose) return texts;
	const runtime = getKnowledgeEmbeddingRuntime(process.env);
	return texts.map((text) => formatKnowledgeEmbeddingInput(text, { purpose, runtime }));
}

/**
 * Generate embeddings for one or more text inputs.
 * Uses OpenAI text-embedding-3-small (512 dimensions).
 *
 * @param texts - Array of SANITIZED texts (Entity-Linked Masked)
 * @returns Array of embedding vectors
 */
export async function generateEmbeddings(
	texts: string[],
	options: GenerateEmbeddingsOptions = {},
): Promise<EmbeddingResult[]> {
	if (texts.length === 0) return [];

	const runtime = getKnowledgeEmbeddingRuntime(process.env);
	if (!runtime.isLocal) {
		assertAiProcessingEnabled('OpenAI embeddings');
	}
	const purpose = options.purpose;
	const input = purpose
		? texts.map((text) => formatKnowledgeEmbeddingInput(text, { purpose, runtime }))
		: texts;
	const apiKey = runtime.isLocal ? runtime.apiKey : await getOpenAIApiKey();
	if (!runtime.isLocal && !apiKey) throw new Error('OpenAI API key is not configured');

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

	const response = await fetch(runtime.embeddingsUrl, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			model: runtime.model,
			input,
			dimensions: runtime.dimensions,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Knowledge embedding API error (${response.status}): ${error}`);
	}

	const data = (await response.json()) as {
		data: Array<{ embedding: number[]; index: number }>;
	};

	return data.data.map((item) => {
		if (item.embedding.length !== runtime.dimensions) {
			throw new Error(
				`Embedding dimension mismatch: expected ${runtime.dimensions}, got ${item.embedding.length}`,
			);
		}
		return { embedding: item.embedding, index: item.index };
	});
}

/**
 * Generate a single embedding for a text.
 */
export async function generateEmbedding(
	text: string,
	options: GenerateEmbeddingsOptions = {},
): Promise<number[]> {
	const results = await generateEmbeddings([text], options);
	if (results.length === 0) throw new Error('No embedding returned');
	return results[0].embedding;
}

/**
 * Generate embeddings with deterministic in-memory caching.
 * Identical sanitized text is embedded once, then replayed to every original index.
 */
export async function generateEmbeddingsCached(
	texts: string[],
	options: GenerateEmbeddingsCachedOptions = {},
): Promise<EmbeddingResult[]> {
	if (texts.length === 0) return [];

	const embeddingInputs = formatEmbeddingInputs(texts, options.purpose);
	const cache = options.cache ?? defaultEmbeddingCache;
	const results = new Array<EmbeddingResult>(embeddingInputs.length);
	const missingTexts: string[] = [];
	const missingTextSet = new Set<string>();

	for (const [index, text] of embeddingInputs.entries()) {
		const cached = cache.get(text);
		if (cached) {
			results[index] = { embedding: cloneEmbedding(cached), index };
			continue;
		}

		if (!missingTextSet.has(text)) {
			missingTextSet.add(text);
			missingTexts.push(text);
		}
	}

	if (missingTexts.length > 0) {
		const generated = await generateEmbeddings(missingTexts);
		const generatedByText = new Map<string, number[]>();

		for (const item of generated) {
			const text = missingTexts[item.index];
			if (text === undefined) {
				throw new Error(`Embedding response index out of range: ${item.index}`);
			}

			const embedding = cloneEmbedding(item.embedding);
			cache.set(text, embedding);
			generatedByText.set(text, embedding);
		}

		for (const text of missingTexts) {
			if (!generatedByText.has(text)) {
				throw new Error('Knowledge embedding API response omitted an input');
			}
		}

		for (const [index, text] of embeddingInputs.entries()) {
			if (results[index]) continue;

			const embedding = generatedByText.get(text) ?? cache.get(text);
			if (!embedding) {
				throw new Error('Embedding cache miss after generation');
			}
			results[index] = { embedding: cloneEmbedding(embedding), index };
		}
	}

	return results;
}

/**
 * Generate a single cached embedding for a text.
 */
export async function generateEmbeddingCached(
	text: string,
	options: GenerateEmbeddingsCachedOptions = {},
): Promise<number[]> {
	const results = await generateEmbeddingsCached([text], options);
	if (results.length === 0) throw new Error('No embedding returned');
	return results[0].embedding;
}

export function clearEmbeddingCache(): void {
	defaultEmbeddingCache.clear();
}
