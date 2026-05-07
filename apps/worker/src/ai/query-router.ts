/**
 * Smart Model Routing (P4 cost optimization).
 *
 * Routes chat queries to Sonnet or Haiku based on keyword signals.
 * Conservative: Sonnet signals win over Haiku, and ambiguous/long
 * queries default to Sonnet.
 *
 * SECURITY: Both model tiers use identical 4-layer prompt structure,
 * identical tool definitions, and identical ELM masking. Only the
 * model parameter changes.
 */

export type ModelTier = 'sonnet' | 'haiku';

const SONNET_SIGNALS =
	/\b(why|trace|draft|analyze|compare|explain|write|compose|strateg|relationship|provenance)\b/i;

const HAIKU_SIGNALS = /\b(search|find|show|list|who|what is|get|how many|status|health)\b/i;

const LONG_QUERY_THRESHOLD = 20;

/**
 * Route a user query to the appropriate model tier.
 *
 * Priority: Sonnet signals > Haiku signals > default (Sonnet for long/ambiguous).
 */
export function routeQuery(query: string): ModelTier {
	if (SONNET_SIGNALS.test(query)) return 'sonnet';
	if (HAIKU_SIGNALS.test(query)) return 'haiku';

	// Long or ambiguous queries default to Sonnet (conservative)
	const wordCount = query.trim().split(/\s+/).length;
	if (wordCount > LONG_QUERY_THRESHOLD) return 'sonnet';

	return 'sonnet';
}

export const MODEL_IDS: Record<ModelTier, string> = {
	sonnet: 'claude-sonnet-4-6',
	haiku: 'claude-haiku-4-5-20251001',
};
