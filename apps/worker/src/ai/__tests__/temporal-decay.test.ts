import { describe, expect, it } from 'vitest';
import { applyTemporalDecay, rerankWithDecay, temporalDecay } from '../temporal-decay';

describe('temporalDecay', () => {
	const now = new Date('2026-02-15T12:00:00Z');

	it('returns 1.0 for current date', () => {
		const decay = temporalDecay(now, now);
		expect(decay).toBeCloseTo(1.0, 5);
	});

	it('returns ~0.5 at the half-life', () => {
		const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
		const decay = temporalDecay(thirtyDaysAgo, now, 30);
		expect(decay).toBeCloseTo(0.5, 2);
	});

	it('returns ~0.25 at double the half-life', () => {
		const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000);
		const decay = temporalDecay(sixtyDaysAgo, now, 30);
		expect(decay).toBeCloseTo(0.25, 2);
	});

	it('returns 1.0 for future dates', () => {
		const tomorrow = new Date(now.getTime() + 86_400_000);
		const decay = temporalDecay(tomorrow, now);
		expect(decay).toBe(1.0);
	});

	it('decays monotonically', () => {
		const oneDay = temporalDecay(new Date(now.getTime() - 86_400_000), now);
		const oneWeek = temporalDecay(new Date(now.getTime() - 7 * 86_400_000), now);
		const oneMonth = temporalDecay(new Date(now.getTime() - 30 * 86_400_000), now);

		expect(oneDay).toBeGreaterThan(oneWeek);
		expect(oneWeek).toBeGreaterThan(oneMonth);
	});

	it('approaches zero for very old memories', () => {
		const oneYear = new Date(now.getTime() - 365 * 86_400_000);
		const decay = temporalDecay(oneYear, now, 30);
		expect(decay).toBeLessThan(0.001);
	});

	it('respects custom half-life', () => {
		const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

		const shortHalfLife = temporalDecay(sevenDaysAgo, now, 7);
		const longHalfLife = temporalDecay(sevenDaysAgo, now, 30);

		expect(shortHalfLife).toBeCloseTo(0.5, 2);
		expect(longHalfLife).toBeGreaterThan(0.5);
	});
});

describe('applyTemporalDecay', () => {
	const now = new Date('2026-02-15T12:00:00Z');

	it('multiplies base score by decay factor', () => {
		const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
		const result = applyTemporalDecay(0.8, thirtyDaysAgo, now, 30);
		expect(result).toBeCloseTo(0.4, 2); // 0.8 * 0.5
	});

	it('returns full score for current time', () => {
		const result = applyTemporalDecay(0.95, now, now);
		expect(result).toBeCloseTo(0.95, 5);
	});
});

describe('rerankWithDecay', () => {
	const now = new Date('2026-02-15T12:00:00Z');

	it('re-ranks results favoring recent items', () => {
		const results = [
			{ score: 0.9, createdAt: new Date(now.getTime() - 60 * 86_400_000), id: 'old' },
			{ score: 0.7, createdAt: new Date(now.getTime() - 1 * 86_400_000), id: 'new' },
		];

		const ranked = rerankWithDecay(results, now, 30);

		// Newer item should rank higher despite lower base score
		expect(ranked[0].id).toBe('new');
		expect(ranked[0].decayedScore).toBeGreaterThan(ranked[1].decayedScore);
	});

	it('preserves order for same-age items', () => {
		const sameDate = new Date(now.getTime() - 5 * 86_400_000);
		const results = [
			{ score: 0.6, createdAt: sameDate, id: 'low' },
			{ score: 0.9, createdAt: sameDate, id: 'high' },
		];

		const ranked = rerankWithDecay(results, now, 30);
		expect(ranked[0].id).toBe('high');
	});
});
