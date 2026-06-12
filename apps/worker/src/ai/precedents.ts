/**
 * Phase 35 (Sprint 18) — Precedent Search
 *
 * Finds similar past outcomes by embedding a free-text query and running
 * cosine similarity over context_label embeddings in the outcomes table.
 *
 * PII guard: returns only non-PII fields (type, result, context_labels,
 * occurred_at). Contact names, encrypted notes, and raw IDs are excluded.
 * The envelope parameter is reserved for future use (e.g., decrypting notes
 * for a summary), but is not used today.
 */

import type { SealedEnvelope } from '@repo/crypto';
import { getCurrentKeys, maskEntities, withKeys } from '@repo/crypto';
import { searchOutcomes } from '@repo/db';
import { generateEmbedding } from './embeddings';
import { prefilterEntities } from './prefilter';

export interface PrecedentContext {
	/** Outcome type (e.g. 'commitment_fulfilled', 'deal_closed') */
	type: string;
	/** Outcome result: positive, negative, or neutral */
	result: string;
	/** Non-PII category labels used to derive the embedding */
	contextLabels: string[];
	/** When the outcome was recorded */
	occurredAt: Date;
}

/**
 * Find outcomes similar to a natural-language query.
 *
 * Embeds the query, searches outcomes by cosine similarity over
 * context_label embeddings, and returns structured (non-PII) context.
 *
 * @param workspaceId - Workspace scope (prevents cross-tenant leakage)
 * @param query - Free-text description of the scenario to find precedents for
 * @param envelope - Sealed envelope for decrypting encrypted notes
 * @param limit - Max number of precedents to return (default 5)
 */
export async function findRelevantPrecedents(
	workspaceId: string,
	query: string,
	envelope: SealedEnvelope,
	limit = 5,
): Promise<PrecedentContext[]> {
	// SEC-300: Mask PII in query before sending to embedding API.
	// Query is AI-generated from conversation context and may contain contact names.
	const maskedQuery = await withKeys(envelope, async () => {
		const keys = getCurrentKeys();
		const detected = prefilterEntities(query);
		return maskEntities(query, keys.bik, detected).maskedText;
	});
	const embedding = await generateEmbedding(maskedQuery);
	const outcomes = await searchOutcomes(workspaceId, embedding, limit, envelope);

	return outcomes.map((o) => ({
		type: o.type,
		result: o.result,
		contextLabels: o.contextLabels,
		occurredAt: o.occurredAt,
	}));
}

/**
 * Format precedents for inclusion in a brief or chat tool response.
 * Returns plain text suitable for an LLM context block.
 */
export function formatPrecedents(precedents: PrecedentContext[]): string {
	if (precedents.length === 0) return 'No similar past outcomes found.';
	return precedents
		.map((p) => {
			const labels = p.contextLabels.join(', ') || 'no labels';
			const when = new Date(p.occurredAt).toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
			});
			return `- [${p.type}] ${p.result.toUpperCase()} — ${labels} (${when})`;
		})
		.join('\n');
}
