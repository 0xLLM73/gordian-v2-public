'use server';

import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';
import { deriveKeys, maskEntities, prefilterEntities, unwrapWrk } from '@repo/crypto';
import type { SealedEnvelope } from '@repo/crypto';
import { unifiedSearch } from '@repo/db';
import { getKnowledgeEmbeddingRuntime, isAiProcessingEnabled } from '@repo/shared';
import { z } from 'zod';

function isSearchEmbeddingEnabled(): boolean {
	if (process.env.AI_SEARCH_EMBEDDINGS_ENABLED !== 'true') return false;
	const runtime = getKnowledgeEmbeddingRuntime(process.env);
	return runtime.isLocal || isAiProcessingEnabled();
}

// Generate embedding for semantic search via worker API.
// Raw queries are never sent to the embedding provider; the query is ELM-masked first.
async function getQueryEmbedding(
	query: string,
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<number[] | null> {
	// Short queries (likely name lookups) don't benefit from embeddings
	if (query.length < 10) return null;
	if (!isSearchEmbeddingEnabled()) return null;

	const workerUrl = process.env.WORKER_URL;
	if (!workerUrl) return null;

	try {
		const wrk = await unwrapWrk(envelope);
		const keys = await deriveKeys(wrk, workspaceId, envelope.wrkVersion);
		const detected = prefilterEntities(query);
		const maskedQuery = maskEntities(query, keys.bik, detected).maskedText;
		const response = await fetch(`${workerUrl}/admin/embed`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': getInternalSecret(),
			},
			body: JSON.stringify({ text: maskedQuery }),
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { embedding: number[] };
		return data.embedding;
	} catch {
		return null;
	}
}

export const searchAction = workspaceAction
	.schema(
		z.object({
			query: z.string().min(1).max(200),
		}),
	)
	.action(async ({ parsedInput, ctx }) => {
		const { query } = parsedInput;
		const { workspaceId, envelope } = ctx;
		if (!envelope) throw new Error('Workspace encryption key not found');

		const embedding = await getQueryEmbedding(query, workspaceId, envelope);
		track(workspaceId, ctx.session.user.id, 'search_contacts');
		return unifiedSearch(workspaceId, query, envelope, embedding);
	});
