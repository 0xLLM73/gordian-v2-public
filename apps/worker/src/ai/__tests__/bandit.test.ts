import type { BanditBucketedStats } from '@repo/db';
import { describe, expect, it } from 'vitest';
import { applyBanditDecay, sampleBeta, thompsonSample } from '../bandit';

describe('applyBanditDecay', () => {
	it('returns empty array for empty buckets', () => {
		const result = applyBanditDecay([]);
		expect(result).toEqual([]);
	});

	it('decays older buckets more than recent ones', () => {
		const buckets: BanditBucketedStats[] = [
			{ promptVariant: 'v1', bucketMidpointDays: 3.5, successes: 10, failures: 5 },
			{ promptVariant: 'v1', bucketMidpointDays: 45, successes: 10, failures: 5 },
		];

		const result = applyBanditDecay(buckets);
		expect(result).toHaveLength(1);

		const v1 = result[0];
		// Recent bucket (3.5d): decay = e^(-ln2/30 * 3.5) ≈ 0.922
		// Old bucket (45d): decay = e^(-ln2/30 * 45) ≈ 0.354
		// alpha = 1 + 10*0.922 + 10*0.354 ≈ 13.76
		// beta  = 1 + 5*0.922 + 5*0.354 ≈ 7.38
		expect(v1.alphaScore).toBeGreaterThan(1);
		expect(v1.alphaScore).toBeLessThan(21); // Without decay would be 1 + 20 = 21
		expect(v1.betaScore).toBeGreaterThan(1);
		expect(v1.betaScore).toBeLessThan(11); // Without decay would be 1 + 10 = 11
	});

	it('never decays below Beta(1,1) prior', () => {
		const buckets: BanditBucketedStats[] = [
			{ promptVariant: 'v1', bucketMidpointDays: 45, successes: 5, failures: 5 },
		];

		const result = applyBanditDecay(buckets);
		expect(result[0].alphaScore).toBeGreaterThanOrEqual(1);
		expect(result[0].betaScore).toBeGreaterThanOrEqual(1);
	});

	it('applies ~0.5 decay at the half-life midpoint', () => {
		const buckets: BanditBucketedStats[] = [
			{ promptVariant: 'v1', bucketMidpointDays: 30, successes: 100, failures: 0 },
		];

		const result = applyBanditDecay(buckets, 30);
		// alpha = 1 + 100 * e^(-ln2) = 1 + 100 * 0.5 = 51
		expect(result[0].alphaScore).toBeCloseTo(51, 0);
		expect(result[0].betaScore).toBeCloseTo(1, 0);
	});

	it('handles multiple variants independently', () => {
		const buckets: BanditBucketedStats[] = [
			{ promptVariant: 'v1', bucketMidpointDays: 3.5, successes: 10, failures: 2 },
			{ promptVariant: 'v2', bucketMidpointDays: 3.5, successes: 2, failures: 10 },
		];

		const result = applyBanditDecay(buckets);
		expect(result).toHaveLength(2);

		const v1 = result.find((r) => r.promptVariant === 'v1');
		const v2 = result.find((r) => r.promptVariant === 'v2');
		expect(v1).toBeDefined();
		expect(v2).toBeDefined();
		expect(v1?.alphaScore ?? 0).toBeGreaterThan(v2?.alphaScore ?? 0);
	});

	it('respects custom half-life', () => {
		const buckets: BanditBucketedStats[] = [
			{ promptVariant: 'v1', bucketMidpointDays: 7, successes: 10, failures: 0 },
		];

		const shortHalfLife = applyBanditDecay(buckets, 7);
		const longHalfLife = applyBanditDecay(buckets, 90);

		// Shorter half-life → more decay → lower alpha
		expect(shortHalfLife[0].alphaScore).toBeLessThan(longHalfLife[0].alphaScore);
	});
});

describe('sampleBeta', () => {
	it('returns values between 0 and 1', () => {
		for (let i = 0; i < 100; i++) {
			const sample = sampleBeta(1, 1);
			expect(sample).toBeGreaterThanOrEqual(0);
			expect(sample).toBeLessThanOrEqual(1);
		}
	});

	it('returns values near 0.5 for Beta(1,1) on average', () => {
		const samples: number[] = [];
		for (let i = 0; i < 1000; i++) {
			samples.push(sampleBeta(1, 1));
		}
		const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
		// Beta(1,1) = Uniform(0,1), mean should be ~0.5
		expect(mean).toBeGreaterThan(0.4);
		expect(mean).toBeLessThan(0.6);
	});

	it('returns values near alpha/(alpha+beta) for general params', () => {
		const alpha = 10;
		const beta = 5;
		const expectedMean = alpha / (alpha + beta); // 0.667

		const samples: number[] = [];
		for (let i = 0; i < 1000; i++) {
			samples.push(sampleBeta(alpha, beta));
		}
		const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
		expect(mean).toBeCloseTo(expectedMean, 1);
	});

	it('concentrates near 1.0 when alpha >> beta', () => {
		const samples: number[] = [];
		for (let i = 0; i < 100; i++) {
			samples.push(sampleBeta(100, 1));
		}
		const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
		expect(mean).toBeGreaterThan(0.95);
	});

	it('concentrates near 0.0 when beta >> alpha', () => {
		const samples: number[] = [];
		for (let i = 0; i < 100; i++) {
			samples.push(sampleBeta(1, 100));
		}
		const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
		expect(mean).toBeLessThan(0.05);
	});

	it('throws for invalid parameters', () => {
		expect(() => sampleBeta(0, 1)).toThrow('Invalid Beta params');
		expect(() => sampleBeta(1, 0)).toThrow('Invalid Beta params');
		expect(() => sampleBeta(-1, 1)).toThrow('Invalid Beta params');
	});

	it('handles fractional alpha/beta (< 1)', () => {
		for (let i = 0; i < 50; i++) {
			const sample = sampleBeta(0.5, 0.5);
			expect(sample).toBeGreaterThanOrEqual(0);
			expect(sample).toBeLessThanOrEqual(1);
		}
	});
});

describe('thompsonSample', () => {
	it('returns one of the provided variants', () => {
		const variants = ['v1', 'v2', 'v3'];
		const result = thompsonSample(variants, []);
		expect(variants).toContain(result);
	});

	it('throws for empty variants', () => {
		expect(() => thompsonSample([], [])).toThrow('No variants to sample from');
	});

	it('favors the variant with higher alpha (more successes)', () => {
		const variants = ['good', 'bad'];
		const stats = [
			{ promptVariant: 'good', alphaScore: 100, betaScore: 2 },
			{ promptVariant: 'bad', alphaScore: 2, betaScore: 100 },
		];

		// Run 100 trials — "good" should win most of the time
		let goodWins = 0;
		for (let i = 0; i < 100; i++) {
			if (thompsonSample(variants, stats) === 'good') goodWins++;
		}

		// Should win at least 90% of the time
		expect(goodWins).toBeGreaterThan(90);
	});

	it('uses uniform prior for unknown variants', () => {
		const variants = ['known', 'unknown'];
		const stats = [{ promptVariant: 'known', alphaScore: 5, betaScore: 5 }];

		// Both should be selected sometimes since "unknown" has Beta(1,1) prior
		let knownWins = 0;
		let unknownWins = 0;
		for (let i = 0; i < 100; i++) {
			const result = thompsonSample(variants, stats);
			if (result === 'known') knownWins++;
			else unknownWins++;
		}

		// Both should have some selections (exploration)
		expect(knownWins).toBeGreaterThan(10);
		expect(unknownWins).toBeGreaterThan(10);
	});

	it('returns the only variant when there is just one', () => {
		const result = thompsonSample(['only'], []);
		expect(result).toBe('only');
	});
});
