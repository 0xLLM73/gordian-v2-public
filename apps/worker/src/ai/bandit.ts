import { randomUUID } from 'node:crypto';
import {
	type BanditBucketedStats,
	type BanditStats,
	finalizeBanditReward,
	getBanditStatsBucketed,
	recordBanditTrial,
} from '@repo/db';

/**
 * Thompson Sampling for prompt variant selection (Phase 6).
 *
 * Each prompt variant has a Beta(alpha, beta) distribution derived from
 * historical reward data in the bandit_ledger table.
 *
 * To select a variant, we sample from each variant's Beta distribution
 * and pick the one with the highest sample — this naturally balances
 * exploration (trying under-tested variants) vs exploitation (using proven ones).
 *
 * Half-life decay (Phase 6 enhancement):
 * Before sampling, alpha/beta contributions from older observations are
 * exponentially decayed so recent feedback outweighs stale data.
 *   alpha_decayed = 1 + Σ(successes_i * e^(-λ * t_i))
 *   beta_decayed  = 1 + Σ(failures_i * e^(-λ * t_i))
 * where t_i is the bucket midpoint in days and λ = ln(2) / 30.
 */

const BANDIT_HALF_LIFE_DAYS = 30;

/**
 * Sample from a Beta distribution using the Joehnk algorithm.
 * No external dependencies needed — uses only Math.random() and Math.log().
 *
 * For alpha, beta >= 1 (which is our case since we initialize at 1),
 * this algorithm is efficient and numerically stable.
 */
export function sampleBeta(alpha: number, beta: number): number {
	if (alpha <= 0 || beta <= 0) {
		throw new Error(`Invalid Beta params: alpha=${alpha}, beta=${beta}`);
	}

	// Use the gamma variate method for general alpha, beta
	const gammaA = sampleGamma(alpha);
	const gammaB = sampleGamma(beta);
	return gammaA / (gammaA + gammaB);
}

/**
 * Sample from Gamma(shape, 1) distribution using Marsaglia and Tsang's method.
 * Works for shape >= 1. For shape < 1, uses Ahrens-Dieter transformation.
 */
function sampleGamma(shape: number): number {
	if (shape < 1) {
		// Ahrens-Dieter: Gamma(a) = Gamma(a+1) * U^(1/a)
		return sampleGamma(shape + 1) * Math.random() ** (1 / shape);
	}

	// Marsaglia and Tsang's method for shape >= 1
	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);

	for (;;) {
		let x: number;
		let v: number;

		// Generate standard normal using Box-Muller
		do {
			const u1 = Math.random();
			const u2 = Math.random();
			x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
			v = (1 + c * x) ** 3;
		} while (v <= 0);

		const u = Math.random();

		// Squeeze test
		if (u < 1 - 0.0331 * x ** 4) return d * v;

		// Full test
		if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
	}
}

/**
 * Apply half-life decay to age-bucketed bandit stats.
 *
 * Converts bucketed stats into final BanditStats with decayed alpha/beta.
 * The decay formula ensures we never go below the uninformative prior Beta(1,1):
 *   alpha = 1 + Σ(successes_i * e^(-λ * midpoint_i))
 *   beta  = 1 + Σ(failures_i * e^(-λ * midpoint_i))
 *
 * @param buckets - Age-bucketed stats from the database
 * @param halfLifeDays - Days until observation weight halves (default: 30)
 * @returns Decayed BanditStats per variant
 */
export function applyBanditDecay(
	buckets: BanditBucketedStats[],
	halfLifeDays: number = BANDIT_HALF_LIFE_DAYS,
): BanditStats[] {
	const lambda = Math.LN2 / halfLifeDays;

	// Group buckets by variant
	const variantMap = new Map<string, { alpha: number; beta: number }>();

	for (const bucket of buckets) {
		const decay = Math.exp(-lambda * bucket.bucketMidpointDays);
		const existing = variantMap.get(bucket.promptVariant) ?? { alpha: 1, beta: 1 };

		existing.alpha += bucket.successes * decay;
		existing.beta += bucket.failures * decay;
		variantMap.set(bucket.promptVariant, existing);
	}

	return Array.from(variantMap.entries()).map(([variant, stats]) => ({
		promptVariant: variant,
		alphaScore: stats.alpha,
		betaScore: stats.beta,
	}));
}

/**
 * Run Thompson Sampling to select the best prompt variant.
 *
 * For each variant, sample from Beta(alpha, beta) and return the variant
 * with the highest sampled value.
 *
 * @param variants - Array of variant names to choose from
 * @param stats    - Current bandit stats from the database
 * @returns The selected variant name
 */
export function thompsonSample(variants: string[], stats: BanditStats[]): string {
	if (variants.length === 0) {
		throw new Error('No variants to sample from');
	}

	// Build a map of variant -> stats
	const statsMap = new Map(stats.map((s) => [s.promptVariant, s]));

	let bestVariant = variants[0];
	let bestSample = -1;

	for (const variant of variants) {
		const stat = statsMap.get(variant);
		// Default prior: Beta(1, 1) = Uniform(0, 1) for unseen variants
		const alpha = stat?.alphaScore ?? 1;
		const beta = stat?.betaScore ?? 1;
		const sample = sampleBeta(alpha, beta);

		if (sample > bestSample) {
			bestSample = sample;
			bestVariant = variant;
		}
	}

	return bestVariant;
}

/**
 * Select a prompt variant using Thompson Sampling and record the trial.
 * Uses age-bucketed stats with half-life decay so recent feedback
 * outweighs stale observations.
 *
 * @param featureDomain - The feature domain (e.g., 'commitment_extraction', 'morning_brief')
 * @param variants      - Available prompt variant names
 * @param userId        - Optional user ID for tracking
 * @returns Selected variant name and trace ID for later reward finalization
 */
export async function selectPromptVariant(
	featureDomain: string,
	variants: string[],
	userId?: string,
): Promise<{ variant: string; traceId: string }> {
	// Fetch age-bucketed stats and apply temporal decay
	const bucketedStats = await getBanditStatsBucketed(userId);
	const decayedStats = applyBanditDecay(bucketedStats);

	// Filter stats to this feature domain's variants
	const relevantStats = decayedStats.filter((s) => variants.includes(s.promptVariant));

	const variant = thompsonSample(variants, relevantStats);
	const traceId = randomUUID();

	await recordBanditTrial({
		traceId,
		variant,
		featureContext: featureDomain,
		userId,
	});

	return { variant, traceId };
}

/**
 * Record the outcome of a bandit trial.
 * Call this when you can measure the quality of the selected variant's output.
 *
 * @param traceId     - The trace ID returned from selectPromptVariant
 * @param rewardScore - Reward between 0.0 (bad) and 1.0 (good)
 */
export async function recordOutcome(traceId: string, rewardScore: number): Promise<void> {
	await finalizeBanditReward(traceId, Math.max(0, Math.min(1, rewardScore)));
}

/**
 * Warm-start mapping from Coffee Test answer to preferred extraction variant.
 *
 * everything  → extraction_lenient  (lenient catches casual promises)
 * specific    → extraction_default  (balanced — default behavior)
 * tasks_only  → extraction_strict   (strict — only explicit action items)
 */
const SENSITIVITY_VARIANT_MAP: Record<string, string> = {
	everything: 'extraction_lenient',
	specific: 'extraction_default',
	tasks_only: 'extraction_strict',
};

/**
 * Seed Thompson Sampling priors based on the user's Coffee Test answer.
 * Inserts synthetic trials (2 successes for the preferred variant) to
 * create a Beta(3,1) prior — biasing initial selections without preventing
 * exploration.
 *
 * Only runs when the user has zero existing ledger entries for commitment_extraction.
 * Called on the first extraction job for a user.
 */
export async function seedBanditPriors(
	commitmentSensitivity: string,
	userId?: string,
): Promise<void> {
	const variant = SENSITIVITY_VARIANT_MAP[commitmentSensitivity];
	if (!variant) return;

	// Check if user already has ledger entries — don't re-seed
	const existingStats = await getBanditStatsBucketed(userId);
	const hasExtractionEntries = existingStats.some(
		(s) =>
			s.promptVariant === 'extraction_default' ||
			s.promptVariant === 'extraction_strict' ||
			s.promptVariant === 'extraction_lenient',
	);

	if (hasExtractionEntries) return;

	// Seed 2 synthetic successful trials → Beta(1+2, 1+0) = Beta(3, 1)
	for (let i = 0; i < 2; i++) {
		const traceId = randomUUID();
		await recordBanditTrial({
			traceId,
			variant,
			featureContext: 'commitment_extraction',
			userId,
		});
		await finalizeBanditReward(traceId, 1.0);
	}

	console.log(
		`[bandit] Seeded priors: ${variant} Beta(3,1) for sensitivity=${commitmentSensitivity}`,
	);
}
