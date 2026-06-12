import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────────

const mockInferWithGemini = vi.hoisted(() => vi.fn());

vi.mock('../gemini-inference', () => ({
	inferWithGemini: mockInferWithGemini,
}));

import { classifyDealIntent } from '../deal-classifier';

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function geminiReturns(result: { isInvestmentDiscussion: boolean; confidence: number }) {
	mockInferWithGemini.mockResolvedValueOnce(JSON.stringify(result));
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('classifyDealIntent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── Positive classifications ────────────────────────────────────────────

	describe('positive classifications', () => {
		it('classifies first-person deal discussion as investment', async () => {
			geminiReturns({ isInvestmentDiscussion: true, confidence: 0.95 });
			const result = await classifyDealIntent('Our term sheet for $2M is ready to sign');
			expect(result.isInvestmentDiscussion).toBe(true);
			expect(result.confidence).toBe(0.95);
		});

		it('passes message text to Gemini as userPrompt', async () => {
			geminiReturns({ isInvestmentDiscussion: true, confidence: 0.9 });
			await classifyDealIntent('SAFT allocation is 500k USDC');
			expect(mockInferWithGemini).toHaveBeenCalledWith({
				systemPrompt: expect.stringContaining('binary classifier'),
				userPrompt: 'SAFT allocation is 500k USDC',
			});
		});

		it('clamps confidence to [0, 1] range', async () => {
			geminiReturns({ isInvestmentDiscussion: true, confidence: 1.5 });
			const result = await classifyDealIntent('Term sheet for $5M');
			expect(result.confidence).toBe(1);
		});

		it('clamps negative confidence to 0', async () => {
			geminiReturns({ isInvestmentDiscussion: false, confidence: -0.3 });
			const result = await classifyDealIntent('Some message');
			expect(result.confidence).toBe(0);
		});
	});

	// ─── Negative classifications ────────────────────────────────────────────

	describe('negative classifications', () => {
		it('classifies gossip as non-investment', async () => {
			geminiReturns({ isInvestmentDiscussion: false, confidence: 0.88 });
			const result = await classifyDealIntent('I heard Paradigm raised their valuation to $500M');
			expect(result.isInvestmentDiscussion).toBe(false);
			expect(result.confidence).toBe(0.88);
		});

		it('classifies historical reference as non-investment', async () => {
			geminiReturns({ isInvestmentDiscussion: false, confidence: 0.92 });
			const result = await classifyDealIntent('Last year their valuation was $30M');
			expect(result.isInvestmentDiscussion).toBe(false);
		});
	});

	// ─── Edge cases ──────────────────────────────────────────────────────────

	describe('edge cases', () => {
		it('returns false for empty string', async () => {
			const result = await classifyDealIntent('');
			expect(result.isInvestmentDiscussion).toBe(false);
			expect(result.confidence).toBe(0);
			expect(mockInferWithGemini).not.toHaveBeenCalled();
		});

		it('returns false for whitespace only', async () => {
			const result = await classifyDealIntent('   ');
			expect(result.isInvestmentDiscussion).toBe(false);
			expect(mockInferWithGemini).not.toHaveBeenCalled();
		});

		it('trims input before sending to Gemini', async () => {
			geminiReturns({ isInvestmentDiscussion: true, confidence: 0.8 });
			await classifyDealIntent('  term sheet $1M  ');
			expect(mockInferWithGemini).toHaveBeenCalledWith(
				expect.objectContaining({ userPrompt: 'term sheet $1M' }),
			);
		});
	});

	// ─── Error handling ──────────────────────────────────────────────────────

	describe('error handling', () => {
		it('returns false on invalid JSON response', async () => {
			mockInferWithGemini.mockResolvedValueOnce('not json at all');
			const result = await classifyDealIntent('SAFT for $1M');
			expect(result.isInvestmentDiscussion).toBe(false);
			expect(result.confidence).toBe(0);
		});

		it('returns false when response has wrong shape', async () => {
			mockInferWithGemini.mockResolvedValueOnce(JSON.stringify({ answer: 'yes' }));
			const result = await classifyDealIntent('SAFT for $1M');
			expect(result.isInvestmentDiscussion).toBe(false);
			expect(result.confidence).toBe(0);
		});

		it('handles markdown-wrapped JSON from Gemini', async () => {
			mockInferWithGemini.mockResolvedValueOnce(
				'```json\n{"isInvestmentDiscussion": true, "confidence": 0.85}\n```',
			);
			const result = await classifyDealIntent('Our valuation is $10M');
			expect(result.isInvestmentDiscussion).toBe(true);
			expect(result.confidence).toBe(0.85);
		});

		it('returns false when isInvestmentDiscussion is not boolean', async () => {
			mockInferWithGemini.mockResolvedValueOnce(
				JSON.stringify({
					isInvestmentDiscussion: 'yes',
					confidence: 0.9,
				}),
			);
			const result = await classifyDealIntent('Term sheet $2M');
			expect(result.isInvestmentDiscussion).toBe(false);
			expect(result.confidence).toBe(0);
		});

		it('returns false when confidence is not a number', async () => {
			mockInferWithGemini.mockResolvedValueOnce(
				JSON.stringify({
					isInvestmentDiscussion: true,
					confidence: 'high',
				}),
			);
			const result = await classifyDealIntent('Term sheet $2M');
			expect(result.isInvestmentDiscussion).toBe(false);
			expect(result.confidence).toBe(0);
		});
	});

	// ─── System prompt verification ──────────────────────────────────────────

	describe('system prompt', () => {
		it('includes YES criteria for first-person deals', async () => {
			geminiReturns({ isInvestmentDiscussion: true, confidence: 0.9 });
			await classifyDealIntent('test');
			const call = mockInferWithGemini.mock.calls[0][0];
			expect(call.systemPrompt).toContain('first-person language');
			expect(call.systemPrompt).toContain('personally involved');
		});

		it('includes NO criteria for gossip and historical', async () => {
			geminiReturns({ isInvestmentDiscussion: false, confidence: 0.9 });
			await classifyDealIntent('test');
			const call = mockInferWithGemini.mock.calls[0][0];
			expect(call.systemPrompt).toContain('gossip');
			expect(call.systemPrompt).toContain('historical');
		});

		it('instructs JSON-only response', async () => {
			geminiReturns({ isInvestmentDiscussion: true, confidence: 0.9 });
			await classifyDealIntent('test');
			const call = mockInferWithGemini.mock.calls[0][0];
			expect(call.systemPrompt).toContain('ONLY a JSON object');
		});
	});
});
