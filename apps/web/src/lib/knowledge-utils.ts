/**
 * Temporal edge decay for knowledge graph nodes.
 * Exponential decay with 90-day half-life: nodes mentioned recently
 * appear more prominent; stale nodes fade visually via opacity.
 */

const HALF_LIFE_DAYS = 90;
const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;
const MS_PER_DAY = 86_400_000;

export interface DecayResult {
	relevanceScore: number;
	opacity: number;
}

/**
 * Compute a decayed relevance score for a knowledge node.
 * Combines mention count with exponential time decay based on lastSeenAt.
 *
 * @param mentionCount - Number of times the node has been mentioned
 * @param lastSeenAt - When the node was last observed (Date, ISO string, or null)
 * @returns relevanceScore (higher = more relevant) and opacity (0.3–1.0)
 */
export function computeDecayedRelevance(
	mentionCount: number,
	lastSeenAt: Date | string | null,
): DecayResult {
	if (!lastSeenAt) {
		return { relevanceScore: mentionCount * 0.3, opacity: 0.3 };
	}

	const lastSeen = typeof lastSeenAt === 'string' ? new Date(lastSeenAt) : lastSeenAt;
	const now = new Date();
	const stableTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const daysSinceSeen = Math.max(0, (stableTodayUtc - lastSeen.getTime()) / MS_PER_DAY);
	const decayFactor = Math.exp(-LAMBDA * daysSinceSeen);

	const relevanceScore = Math.round(mentionCount * decayFactor * 1000) / 1000;
	const opacity = Math.round(Math.max(0.3, Math.min(1.0, decayFactor)) * 1000) / 1000;

	return { relevanceScore, opacity };
}

/**
 * Sort knowledge nodes by decayed relevance (highest first).
 * Attaches `relevanceScore` and `opacity` to each node for rendering.
 */
export function sortByRelevance<
	T extends { mentionCount: number | null; lastSeenAt: Date | string | null },
>(nodes: T[]): Array<T & DecayResult> {
	return nodes
		.map((node) => {
			const { relevanceScore, opacity } = computeDecayedRelevance(
				node.mentionCount ?? 0,
				node.lastSeenAt,
			);
			return { ...node, relevanceScore, opacity };
		})
		.sort((a, b) => b.relevanceScore - a.relevanceScore);
}
