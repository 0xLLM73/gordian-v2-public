'use server';

import type { SealedEnvelope } from '@repo/crypto';
import { deriveKeys, maskEntities, prefilterEntities, unwrapWrk } from '@repo/crypto';
import { unifiedSearch } from '@repo/db';
import { getKnowledgeEmbeddingRuntime, isAiProcessingEnabled } from '@repo/shared';
import { z } from 'zod';
import { getInternalSecret, workspaceAction } from '@/lib/safe-action';
import { track } from '@/lib/track';

type SearchEmbeddingProviderMode = 'disabled' | 'local' | 'cloud';

interface SearchEmbeddingMeta {
	enabled: boolean;
	used: boolean;
	providerMode: SearchEmbeddingProviderMode;
	providerLabel: string;
	model?: string;
	dimensions?: number;
	queryMasked: boolean;
	skippedReason?: string;
}

function disabledSearchEmbeddingMeta(skippedReason: string): SearchEmbeddingMeta {
	return {
		enabled: false,
		used: false,
		providerMode: 'disabled',
		providerLabel: 'Text search only',
		queryMasked: false,
		skippedReason,
	};
}

function getSearchEmbeddingPlan(query: string): SearchEmbeddingMeta {
	if (query.length < 10) return disabledSearchEmbeddingMeta('Short queries use exact/text search.');
	if (process.env.AI_SEARCH_EMBEDDINGS_ENABLED !== 'true') {
		return disabledSearchEmbeddingMeta('Semantic search embeddings are disabled.');
	}

	let runtime: ReturnType<typeof getKnowledgeEmbeddingRuntime>;
	try {
		runtime = getKnowledgeEmbeddingRuntime(process.env);
	} catch {
		return disabledSearchEmbeddingMeta('Semantic search embedding runtime is misconfigured.');
	}
	if (!runtime.isLocal && !isAiProcessingEnabled()) {
		return disabledSearchEmbeddingMeta('Vendor AI egress is disabled.');
	}

	if (!process.env.WORKER_URL) {
		return {
			enabled: true,
			used: false,
			providerMode: runtime.mode,
			providerLabel: runtime.label,
			model: runtime.model,
			dimensions: runtime.dimensions,
			queryMasked: false,
			skippedReason: 'Worker URL is not configured.',
		};
	}

	return {
		enabled: true,
		used: false,
		providerMode: runtime.mode,
		providerLabel: runtime.label,
		model: runtime.model,
		dimensions: runtime.dimensions,
		queryMasked: false,
	};
}

// Generate embedding for semantic search via worker API.
// Raw queries are never sent to the embedding provider; the query is ELM-masked first.
async function getQueryEmbeddingWithMeta(
	query: string,
	workspaceId: string,
	envelope: SealedEnvelope,
): Promise<{ embedding: number[] | null; meta: SearchEmbeddingMeta }> {
	const meta = getSearchEmbeddingPlan(query);
	if (!meta.enabled || meta.skippedReason) return { embedding: null, meta };

	const workerUrl = process.env.WORKER_URL as string;

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
		if (!response.ok) {
			return {
				embedding: null,
				meta: {
					...meta,
					queryMasked: true,
					skippedReason: 'Embedding request failed; search fell back to text/exact matches.',
				},
			};
		}
		const data = (await response.json()) as { embedding: number[] };
		if (!Array.isArray(data.embedding)) {
			return {
				embedding: null,
				meta: {
					...meta,
					queryMasked: true,
					skippedReason: 'Embedding response was invalid; search fell back to text/exact matches.',
				},
			};
		}
		return {
			embedding: data.embedding,
			meta: {
				...meta,
				used: true,
				queryMasked: true,
			},
		};
	} catch {
		return {
			embedding: null,
			meta: {
				...meta,
				queryMasked: true,
				skippedReason: 'Embedding request failed; search fell back to text/exact matches.',
			},
		};
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

		const { embedding, meta } = await getQueryEmbeddingWithMeta(query, workspaceId, envelope);
		track(workspaceId, ctx.session.user.id, 'search_contacts');
		const results = await unifiedSearch(workspaceId, query, envelope, embedding);
		return {
			...results,
			meta: {
				queryLength: query.length,
				embedding: {
					...meta,
					used: Boolean(embedding),
				},
				sources: {
					contacts: 'Encrypted exact/name search',
					memories: embedding ? 'Hybrid semantic + text search' : 'Text search',
					commitments: embedding
						? 'Semantic vector + encrypted-text fallback'
						: 'Encrypted-text fallback',
					deals: 'Encrypted exact title search',
					knowledge: 'Evidence-backed knowledge search runs separately',
					goals: 'Title search runs separately',
				},
			},
		};
	});
