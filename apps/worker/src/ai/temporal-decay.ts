/**
 * Temporal Decay for Memory Relevance (pillar7):
 *
 * Older memories decay in relevance unless reinforced by recent interactions.
 * Uses an exponential decay function with a configurable half-life.
 *
 * Score(t) = base_score * e^(-λ * Δt)
 * where λ = ln(2) / half_life_days
 *
 * Default half-life: 30 days (memory retains 50% relevance after 30 days)
 */

const DEFAULT_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const LN2 = Math.LN2;

/**
 * Calculate the decay multiplier for a given age.
 *
 * @param createdAt - When the memory was created
 * @param now - Current time (defaults to Date.now())
 * @param halfLifeDays - Days until memory retains 50% relevance
 * @returns Decay multiplier between 0 and 1
 */
export function temporalDecay(
	createdAt: Date,
	now: Date = new Date(),
	halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
	const ageDays = (now.getTime() - createdAt.getTime()) / MS_PER_DAY;

	// Future dates or same day → no decay
	if (ageDays <= 0) return 1.0;

	const lambda = LN2 / halfLifeDays;
	return Math.exp(-lambda * ageDays);
}

/**
 * Apply temporal decay to a base relevance score.
 *
 * @param baseScore - Original relevance score (e.g., from hybrid search)
 * @param createdAt - When the memory was created
 * @param now - Current time
 * @param halfLifeDays - Decay half-life in days
 * @returns Decayed score
 */
export function applyTemporalDecay(
	baseScore: number,
	createdAt: Date,
	now: Date = new Date(),
	halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
	return baseScore * temporalDecay(createdAt, now, halfLifeDays);
}

/**
 * Re-rank search results with temporal decay applied.
 * Returns results sorted by decayed score (descending).
 */
export function rerankWithDecay<T extends { score: number; createdAt: Date }>(
	results: T[],
	now: Date = new Date(),
	halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): Array<T & { decayedScore: number }> {
	return results
		.map((result) => ({
			...result,
			decayedScore: applyTemporalDecay(result.score, result.createdAt, now, halfLifeDays),
		}))
		.sort((a, b) => b.decayedScore - a.decayedScore);
}
