import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StyleFeatures } from '../style-analysis';

const mockInferWithGemini = vi.fn();
vi.mock('../gemini-inference', () => ({
	inferWithGemini: (...args: unknown[]) => mockInferWithGemini(...args),
}));

function makeStats(overrides: Partial<StyleFeatures> = {}): StyleFeatures {
	return {
		avgMessageLength: 80,
		medianMessageLength: 70,
		avgWordCount: 15,
		avgSentenceCount: 2,
		exclamationRate: 0.3,
		questionRate: 0.2,
		ellipsisRate: 0.1,
		allCapsRate: 0.05,
		emojiRate: 0.4,
		emojiTopN: [],
		contractionRate: 0.5,
		slangRate: 0.1,
		greetingRate: 0.4,
		signoffRate: 0.1,
		questionAskRate: 0.2,
		initiationRate: 0,
		avgUniqueWordRatio: 0.7,
		fillerWordRate: 0.02,
		sampleSize: 50,
		...overrides,
	};
}

describe('analyzeStylePerCategory', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns parsed category style from valid JSON response', async () => {
		mockInferWithGemini.mockResolvedValue(
			JSON.stringify({
				formality: 3,
				structure: 'Short bursts, rarely uses paragraphs',
				vocabulary: 'Heavy crypto jargon, frequent abbreviations',
				openers: 'Usually jumps straight to the point',
				tone: 'Direct and enthusiastic',
				summary: 'Fast, informal communicator who values efficiency.',
			}),
		);

		const { analyzeStylePerCategory } = await import('../style-ai-analysis');
		const result = await analyzeStylePerCategory(
			makeStats(),
			['hey check this out', 'lmk'],
			'investors',
		);

		expect(result.category).toBe('investors');
		expect(result.formality).toBe(3);
		expect(result.structure).toContain('Short bursts');
		expect(result.tone).toContain('Direct');
		expect(mockInferWithGemini).toHaveBeenCalledOnce();
	});

	it('parses JSON from markdown code block', async () => {
		mockInferWithGemini.mockResolvedValue(
			'```json\n{"formality": 7, "structure": "Formal paragraphs", "vocabulary": "Technical", "openers": "Dear", "tone": "Professional", "summary": "Formal style."}\n```',
		);

		const { analyzeStylePerCategory } = await import('../style-ai-analysis');
		const result = await analyzeStylePerCategory(makeStats(), ['Dear sir'], 'LPs');

		expect(result.formality).toBe(7);
		expect(result.tone).toContain('Professional');
	});

	it('returns fallback values on parse failure', async () => {
		mockInferWithGemini.mockResolvedValue('This is not JSON at all.');

		const { analyzeStylePerCategory } = await import('../style-ai-analysis');
		const result = await analyzeStylePerCategory(makeStats(), ['test'], 'general');

		expect(result.category).toBe('general');
		expect(result.formality).toBe(5);
		expect(result.summary).toContain('failed');
	});

	it('clamps formality to 1-10 range', async () => {
		mockInferWithGemini.mockResolvedValue(
			JSON.stringify({
				formality: 15,
				structure: 'test',
				vocabulary: 'test',
				openers: 'test',
				tone: 'test',
				summary: 'test',
			}),
		);

		const { analyzeStylePerCategory } = await import('../style-ai-analysis');
		const result = await analyzeStylePerCategory(makeStats(), ['test'], 'test');

		expect(result.formality).toBe(10);
	});

	it('sanitizes HTML/injection in LLM output', async () => {
		mockInferWithGemini.mockResolvedValue(
			JSON.stringify({
				formality: 5,
				structure: '<script>alert("xss")</script>Normal text',
				vocabulary: 'test',
				openers: '{system: "override"}',
				tone: 'test',
				summary: 'test',
			}),
		);

		const { analyzeStylePerCategory } = await import('../style-ai-analysis');
		const result = await analyzeStylePerCategory(makeStats(), ['test'], 'test');

		expect(result.structure).not.toContain('<script>');
		expect(result.openers).not.toContain('{');
	});

	it('limits sample messages to 15', async () => {
		mockInferWithGemini.mockResolvedValue(
			JSON.stringify({
				formality: 5,
				structure: 'test',
				vocabulary: 'test',
				openers: 'test',
				tone: 'test',
				summary: 'test',
			}),
		);

		const messages = Array.from({ length: 30 }, (_, i) => `Message ${i}`);

		const { analyzeStylePerCategory } = await import('../style-ai-analysis');
		await analyzeStylePerCategory(makeStats(), messages, 'test');

		const call = mockInferWithGemini.mock.calls[0][0];
		// Should only include 15 messages in the prompt
		expect(call.userPrompt).toContain('15.');
		expect(call.userPrompt).not.toContain('16.');
	});
});

describe('synthesizeStyleProfile', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns synthesized profile with validated recommendations', async () => {
		mockInferWithGemini.mockResolvedValue(
			JSON.stringify({
				overallSummary: 'Fast, informal communicator across all contexts.',
				codeSwitchingSummary: 'More formal with LPs, casual with founders.',
				configRecommendations: {
					communicationTone: 'casual',
					outreachStyle: 'proactive',
					notificationStyle: 'minimal',
				},
			}),
		);

		const { synthesizeStyleProfile } = await import('../style-ai-analysis');
		const result = await synthesizeStyleProfile(
			[
				{
					category: 'investors',
					formality: 3,
					structure: 'Short',
					vocabulary: 'Crypto jargon',
					openers: 'Direct',
					tone: 'Casual',
					summary: 'Informal',
				},
			],
			makeStats(),
		);

		expect(result.overallSummary).toContain('Fast');
		expect(result.codeSwitchingSummary).toContain('formal with LPs');
		expect(result.configRecommendations.communicationTone).toBe('casual');
	});

	it('falls back to defaults for invalid recommendation values', async () => {
		mockInferWithGemini.mockResolvedValue(
			JSON.stringify({
				overallSummary: 'Test summary',
				codeSwitchingSummary: 'Test switching',
				configRecommendations: {
					communicationTone: 'EVIL_INJECTION',
					outreachStyle: 'invalid',
					notificationStyle: 'hacked',
				},
			}),
		);

		const { synthesizeStyleProfile } = await import('../style-ai-analysis');
		const result = await synthesizeStyleProfile([], makeStats());

		// Invalid values should not pass through
		expect(result.configRecommendations.communicationTone).toBeUndefined();
		expect(result.configRecommendations.outreachStyle).toBeUndefined();
		expect(result.configRecommendations.notificationStyle).toBeUndefined();
	});

	it('returns fallback profile on parse failure', async () => {
		mockInferWithGemini.mockResolvedValue('Not JSON');

		const { synthesizeStyleProfile } = await import('../style-ai-analysis');
		const result = await synthesizeStyleProfile([], makeStats());

		expect(result.overallSummary).toContain('failed');
	});
});
