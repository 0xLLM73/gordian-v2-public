import { describe, expect, it } from 'vitest';
import {
	computeFrequency,
	computeFulfillment,
	computeLabel,
	computeRecency,
	computeTrend,
	getDecayLambda,
} from '../../queues/health-scoring';

describe('scoring functions', () => {
	// ── getDecayLambda ────────────────────────────────────────────────────────

	it('getDecayLambda: known type returns correct lambda', () => {
		expect(getDecayLambda('co_founder')).toBe(0.069);
		expect(getDecayLambda('investor')).toBe(0.023);
		expect(getDecayLambda('client')).toBe(0.033);
	});

	it('getDecayLambda: unknown type falls back to default', () => {
		expect(getDecayLambda('unicorn')).toBe(0.05);
		expect(getDecayLambda(undefined)).toBe(0.05);
		expect(getDecayLambda(null)).toBe(0.05);
	});

	// ── computeRecency ────────────────────────────────────────────────────────

	it('computeRecency: 0 days = 1.0', () => {
		expect(computeRecency(0)).toBeCloseTo(1.0, 5);
	});

	it('computeRecency: null = 0', () => {
		expect(computeRecency(null)).toBe(0);
	});

	it('computeRecency: 14 days ~ 0.5 for employee lambda (ln2 / 0.050 ≈ 13.86)', () => {
		// e^(-0.050 * 13.86) ≈ 0.5
		const result = computeRecency(Math.log(2) / 0.05, 'employee');
		expect(result).toBeCloseTo(0.5, 2);
	});

	it('computeRecency: 30 days ~ 0.5 for investor lambda (ln2 / 0.023 ≈ 30.1)', () => {
		const result = computeRecency(Math.log(2) / 0.023, 'investor');
		expect(result).toBeCloseTo(0.5, 2);
	});

	it('computeRecency: score decreases as days increase', () => {
		const r1 = computeRecency(0);
		const r2 = computeRecency(10);
		const r3 = computeRecency(30);
		expect(r1).toBeGreaterThan(r2);
		expect(r2).toBeGreaterThan(r3);
	});

	// ── computeFrequency (Gaussian bell curve) ──────────────────────────────

	it('computeFrequency: default center (5 msgs/week) = 1.0', () => {
		expect(computeFrequency(5)).toBeCloseTo(1.0, 5);
	});

	it('computeFrequency: 0 msgs/week < 1.0 (below center)', () => {
		expect(computeFrequency(0)).toBeLessThan(1.0);
	});

	it('computeFrequency: far from center is penalized', () => {
		expect(computeFrequency(50)).toBeLessThan(0.01);
	});

	it('computeFrequency: investor center = 1 msg/week', () => {
		expect(computeFrequency(1, 'investor')).toBeCloseTo(1.0, 5);
	});

	it('computeFrequency: output is always in [0, 1]', () => {
		for (const n of [0, 1, 5, 10, 20, 100]) {
			const result = computeFrequency(n);
			expect(result).toBeGreaterThanOrEqual(0);
			expect(result).toBeLessThanOrEqual(1);
		}
	});

	// ── computeFulfillment ────────────────────────────────────────────────────

	it('computeFulfillment: 0 total = 0.5 (neutral)', () => {
		expect(computeFulfillment(0, 0)).toBe(0.5);
	});

	it('computeFulfillment: all completed = 1.0', () => {
		expect(computeFulfillment(5, 5)).toBe(1.0);
	});

	it('computeFulfillment: none completed = 0.0', () => {
		expect(computeFulfillment(0, 5)).toBe(0.0);
	});

	it('computeFulfillment: partial completion', () => {
		expect(computeFulfillment(2, 4)).toBe(0.5);
		expect(computeFulfillment(3, 4)).toBeCloseTo(0.75, 5);
	});

	// ── computeLabel ─────────────────────────────────────────────────────────

	it('computeLabel: 0.8 = thriving', () => {
		expect(computeLabel(0.8)).toBe('thriving');
	});

	it('computeLabel: 0.75 = thriving (boundary)', () => {
		expect(computeLabel(0.75)).toBe('thriving');
	});

	it('computeLabel: 0.6 = healthy', () => {
		expect(computeLabel(0.6)).toBe('healthy');
	});

	it('computeLabel: 0.5 = healthy (boundary)', () => {
		expect(computeLabel(0.5)).toBe('healthy');
	});

	it('computeLabel: 0.3 = cooling', () => {
		expect(computeLabel(0.3)).toBe('cooling');
	});

	it('computeLabel: 0.25 = cooling (boundary)', () => {
		expect(computeLabel(0.25)).toBe('cooling');
	});

	it('computeLabel: 0.1 = dormant', () => {
		expect(computeLabel(0.1)).toBe('dormant');
	});

	it('computeLabel: 0.0 = dormant', () => {
		expect(computeLabel(0.0)).toBe('dormant');
	});

	// ── computeTrend ─────────────────────────────────────────────────────────

	it('computeTrend: +0.1 delta = improving', () => {
		expect(computeTrend(0.7, 0.6)).toBe('improving');
	});

	it('computeTrend: -0.1 delta = declining', () => {
		expect(computeTrend(0.5, 0.6)).toBe('declining');
	});

	it('computeTrend: null previous = stable', () => {
		expect(computeTrend(0.6, null)).toBe('stable');
	});

	it('computeTrend: ±0.03 delta = stable (within threshold)', () => {
		expect(computeTrend(0.63, 0.6)).toBe('stable');
		expect(computeTrend(0.57, 0.6)).toBe('stable');
	});

	it('computeTrend: exactly 0.05 delta = stable (not improving)', () => {
		// delta = 0.05, threshold is > 0.05
		expect(computeTrend(0.65, 0.6)).toBe('stable');
	});

	it('computeTrend: exactly -0.05 delta = stable (not declining)', () => {
		expect(computeTrend(0.55, 0.6)).toBe('stable');
	});
});
