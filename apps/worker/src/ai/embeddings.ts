/**
 * Embedding Pipeline (pillar7):
 * Generates vector embeddings using OpenAI text-embedding-3-small via fetch.
 *
 * CRITICAL: Input text MUST be sanitized via Entity-Linked Masking
 * before calling generateEmbeddings(). Embeddings are invertible —
 * Vec2Text recovers 92% of 32-token text. (followup12a)
 */

const OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 512;

export interface EmbeddingResult {
	embedding: number[];
	index: number;
}

/**
 * Generate embeddings for one or more text inputs.
 * Uses OpenAI text-embedding-3-small (512 dimensions).
 *
 * @param texts - Array of SANITIZED texts (Entity-Linked Masked)
 * @returns Array of embedding vectors
 */
export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
	if (texts.length === 0) return [];

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

	const response = await fetch(OPENAI_EMBEDDING_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: EMBEDDING_MODEL,
			input: texts,
			dimensions: EMBEDDING_DIMENSIONS,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI Embedding API error (${response.status}): ${error}`);
	}

	const data = (await response.json()) as {
		data: Array<{ embedding: number[]; index: number }>;
	};

	return data.data.map((item) => {
		if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
			throw new Error(
				`Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${item.embedding.length}`,
			);
		}
		return { embedding: item.embedding, index: item.index };
	});
}

/**
 * Generate a single embedding for a text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
	const results = await generateEmbeddings([text]);
	if (results.length === 0) throw new Error('No embedding returned');
	return results[0].embedding;
}
