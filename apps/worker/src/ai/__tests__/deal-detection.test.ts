import { describe, expect, it } from 'vitest';
import { detectDealSignals } from '../deal-detection';

describe('detectDealSignals', () => {
	// ─── True Positives ──────────────────────────────────────────────────────

	describe('true positives', () => {
		it('detects term sheet with dollar amount', () => {
			const result = detectDealSignals('We should send the term sheet for $2M');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('term sheet');
		});

		it('detects SAFT with USDC', () => {
			const result = detectDealSignals('SAFT is ready, 500k USDC allocation');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('saft');
			expect(result.matchedKeywords).toContain('allocation');
		});

		it('detects valuation with number pattern', () => {
			const result = detectDealSignals('They want a $50M valuation for the seed round');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('valuation');
		});

		it('detects cap table with percentage', () => {
			const result = detectDealSignals('Cap table shows us at 15% after dilution');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('cap table');
		});

		it('detects vesting with timeline numbers', () => {
			const result = detectDealSignals('Vesting schedule is 4 years with 1 year cliff, 10% tokens');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('vesting');
		});

		it('detects token warrant with ETH', () => {
			const result = detectDealSignals('Token warrant gives us 2% at 100 ETH');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('token warrant');
		});

		it('detects pre-money and post-money together', () => {
			const result = detectDealSignals('Pre-money is $10M, post-money $12M');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('pre-money');
			expect(result.matchedKeywords).toContain('post-money');
		});

		it('detects convertible note with amount', () => {
			const result = detectDealSignals("Let's structure this as a convertible note for $500K");
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('convertible note');
		});

		it('detects allocation with USDT', () => {
			const result = detectDealSignals('Your allocation is 200K USDT');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('allocation');
		});

		it('handles case insensitivity', () => {
			const result = detectDealSignals('The TERM SHEET is for $1.5M');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('term sheet');
		});

		it('detects multiple keywords in one message', () => {
			const result = detectDealSignals(
				'Term sheet includes valuation at $20M with vesting over 4 years at 8%',
			);
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords.length).toBeGreaterThanOrEqual(2);
		});

		it('detects K/M/B number suffixes', () => {
			const result = detectDealSignals('Valuation is 50M with 2B FDV');
			expect(result.passed).toBe(true);
			expect(result.matchedKeywords).toContain('valuation');
		});
	});

	// ─── True Negatives (No Keywords) ────────────────────────────────────────

	describe('true negatives — no keywords', () => {
		it('rejects plain message with no deal keywords', () => {
			const result = detectDealSignals('Hey, want to grab coffee tomorrow?');
			expect(result.passed).toBe(false);
			expect(result.matchedKeywords).toHaveLength(0);
		});

		it('rejects message with numbers but no keywords', () => {
			const result = detectDealSignals('Meeting at 3pm, $50 for lunch');
			expect(result.passed).toBe(false);
		});

		it('rejects empty string', () => {
			expect(detectDealSignals('').passed).toBe(false);
		});

		it('rejects whitespace only', () => {
			expect(detectDealSignals('   ').passed).toBe(false);
		});
	});

	// ─── True Negatives (Keywords but No Currency) ───────────────────────────

	describe('true negatives — keywords without currency/numbers', () => {
		it('rejects keyword without currency indicator', () => {
			const result = detectDealSignals('We need to discuss the term sheet details');
			expect(result.passed).toBe(false);
		});

		it('rejects vesting mention without numbers', () => {
			const result = detectDealSignals('The vesting schedule needs review');
			expect(result.passed).toBe(false);
		});
	});

	// ─── False Positive Filters: Gossip/News ─────────────────────────────────

	describe('false positive filter — gossip/news', () => {
		it('filters out "I heard X raised" pattern', () => {
			const result = detectDealSignals(
				'I heard Paradigm raised their valuation to $500M in the latest round',
			);
			expect(result.passed).toBe(false);
		});

		it('filters out "according to" pattern', () => {
			const result = detectDealSignals('According to The Block, the SAFT was $10M');
			expect(result.passed).toBe(false);
		});

		it('filters out "did you see" pattern', () => {
			const result = detectDealSignals('Did you see the term sheet Sequoia offered for $25M?');
			expect(result.passed).toBe(false);
		});

		it('filters out "sources say" pattern', () => {
			const result = detectDealSignals('Sources say the valuation is $100M pre-money');
			expect(result.passed).toBe(false);
		});
	});

	// ─── False Positive Filters: Historical ──────────────────────────────────

	describe('false positive filter — historical', () => {
		it('filters out "last year" references', () => {
			const result = detectDealSignals('Last year their valuation was $30M, totally different now');
			expect(result.passed).toBe(false);
		});

		it('filters out "years ago" references', () => {
			const result = detectDealSignals('We looked at that SAFT 2 years ago for $5M');
			expect(result.passed).toBe(false);
		});

		it('filters out "back when" references', () => {
			const result = detectDealSignals('Back when we looked at the term sheet it was $10M');
			expect(result.passed).toBe(false);
		});
	});

	// ─── False Positive Filters: Retail Crypto ───────────────────────────────

	describe('false positive filter — retail crypto', () => {
		it('filters out airdrop mentions', () => {
			const result = detectDealSignals('Token allocation for the airdrop is 1000 USDC');
			expect(result.passed).toBe(false);
		});

		it('filters out whitelist mentions', () => {
			const result = detectDealSignals('Whitelist allocation is $500 with vesting');
			expect(result.passed).toBe(false);
		});

		it('filters out degen/aping', () => {
			const result = detectDealSignals('Degen move but the valuation is only $2M, aping in');
			expect(result.passed).toBe(false);
		});

		it('filters out DYOR/NFA', () => {
			const result = detectDealSignals('NFA but the SAFT is $10M, DYOR');
			expect(result.passed).toBe(false);
		});
	});

	// ─── Return Shape ────────────────────────────────────────────────────────

	describe('return shape', () => {
		it('always returns tier: 1', () => {
			const pass = detectDealSignals('SAFT for $1M');
			const fail = detectDealSignals('hello world');
			expect(pass.tier).toBe(1);
			expect(fail.tier).toBe(1);
		});

		it('returns deduplicated keywords', () => {
			const result = detectDealSignals('The valuation is $10M. Yes, the valuation.');
			expect(result.passed).toBe(true);
			const valuationCount = result.matchedKeywords.filter((k) => k === 'valuation').length;
			expect(valuationCount).toBe(1);
		});

		it('returns lowercase keywords', () => {
			const result = detectDealSignals('TERM SHEET for $5M with VESTING at 10%');
			expect(result.passed).toBe(true);
			for (const kw of result.matchedKeywords) {
				expect(kw).toBe(kw.toLowerCase());
			}
		});
	});
});
