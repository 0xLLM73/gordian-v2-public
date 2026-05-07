import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for fulfillment detection AI worker.
 * Verifies Haiku model usage, entity masking, confidence filtering,
 * Thompson Sampling, and Helicone attribution without actual API calls.
 */

// Mock Anthropic SDK
const createSpy = vi.fn().mockResolvedValue({
	content: [
		{
			type: 'tool_use',
			id: 'call-1',
			name: 'report_fulfillment',
			input: {
				commitment_id: 'commit-1',
				fulfilled: true,
				evidence: 'Here is the document you requested',
				confidence: 0.9,
			},
		},
	],
});

vi.mock('@anthropic-ai/sdk', () => ({
	default: vi.fn(function MockAnthropic() {
		return {
			messages: { create: createSpy },
		};
	}),
}));

// Mock bandit
const selectPromptVariantSpy = vi.fn().mockResolvedValue({
	variant: 'detection_default',
	traceId: '00000000-0000-0000-0000-000000000001',
});

vi.mock('../bandit', () => ({
	selectPromptVariant: selectPromptVariantSpy,
}));

// Mock cached-inference (only need getHeliconeHeaders)
vi.mock('../cached-inference', () => ({
	getHeliconeHeaders: vi.fn().mockReturnValue({
		'Helicone-Property-Feature': 'fulfillment-detection',
	}),
}));

// Mock entity masking
const maskEntitiesSpy = vi.fn().mockImplementation((text: string) => ({
	maskedText: text.replace(/Alice/g, '[PERSON_1]'),
	entityMap: [],
}));

vi.mock('@repo/crypto', () => ({
	maskEntities: maskEntitiesSpy,
}));

// Mock prefilter
const prefilterEntitiesSpy = vi.fn().mockReturnValue([]);

vi.mock('../prefilter', () => ({
	prefilterEntities: prefilterEntitiesSpy,
}));

const { detectFulfillment } = await import('../fulfillment-detection');

describe('detectFulfillment', () => {
	const commitments = [
		{ id: 'commit-1', title: 'Send Q3 report', commitmentType: 'promise' },
		{ id: 'commit-2', title: 'Schedule call with Alice', commitmentType: 'meeting' },
	];

	const messages = [
		{
			role: 'user',
			content: 'Here is the document you requested from Alice',
			timestamp: '2026-01-15T10:00:00Z',
		},
		{
			role: 'contact',
			content: 'Thanks, got it!',
			timestamp: '2026-01-15T10:01:00Z',
		},
	];

	const salt = Buffer.from('test-workspace-salt');

	it('returns empty results when no commitments provided', async () => {
		const result = await detectFulfillment([], messages, salt);
		expect(result.results).toEqual([]);
		expect(result.variant).toBe('skipped');
	});

	it('returns empty results when no messages provided', async () => {
		const result = await detectFulfillment(commitments, [], salt);
		expect(result.results).toEqual([]);
		expect(result.variant).toBe('skipped');
	});

	it('calls Haiku model (not Sonnet)', async () => {
		createSpy.mockClear();

		await detectFulfillment(commitments, messages, salt, 'user-123');

		expect(createSpy).toHaveBeenCalledTimes(1);
		const callArgs = createSpy.mock.calls[0][0];
		expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
	});

	it('applies entity masking to messages before AI call', async () => {
		maskEntitiesSpy.mockClear();
		prefilterEntitiesSpy.mockClear();

		await detectFulfillment(commitments, messages, salt);

		// prefilterEntities called for each message
		expect(prefilterEntitiesSpy).toHaveBeenCalledTimes(2);

		// maskEntities called for each message
		expect(maskEntitiesSpy).toHaveBeenCalledTimes(2);
		expect(maskEntitiesSpy).toHaveBeenCalledWith(
			'Here is the document you requested from Alice',
			salt,
			[],
		);
	});

	it('filters out results with confidence below 0.7', async () => {
		createSpy.mockResolvedValueOnce({
			content: [
				{
					type: 'tool_use',
					id: 'call-1',
					name: 'report_fulfillment',
					input: {
						commitment_id: 'commit-1',
						fulfilled: true,
						evidence: 'Might have been sent',
						confidence: 0.5,
					},
				},
			],
		});

		const result = await detectFulfillment(commitments, messages, salt);
		expect(result.results).toEqual([]);
	});

	it('includes Helicone headers with feature fulfillment-detection', async () => {
		createSpy.mockClear();
		const { getHeliconeHeaders } = await import('../cached-inference');

		await detectFulfillment(commitments, messages, salt);

		expect(getHeliconeHeaders).toHaveBeenCalledWith({
			feature: 'fulfillment-detection',
			banditArm: 'detection_default',
		});
	});

	it('selects variant via Thompson Sampling', async () => {
		selectPromptVariantSpy.mockClear();

		await detectFulfillment(commitments, messages, salt, 'user-789');

		expect(selectPromptVariantSpy).toHaveBeenCalledWith(
			'fulfillment_detection',
			['detection_default', 'detection_strict', 'detection_permissive'],
			'user-789',
		);
	});

	it('returns fulfilled results with correct structure', async () => {
		createSpy.mockResolvedValueOnce({
			content: [
				{
					type: 'tool_use',
					id: 'call-1',
					name: 'report_fulfillment',
					input: {
						commitment_id: 'commit-1',
						fulfilled: true,
						evidence: 'Document was sent and confirmed',
						confidence: 0.95,
					},
				},
			],
		});

		const result = await detectFulfillment(commitments, messages, salt, 'user-123');

		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toEqual({
			commitmentId: 'commit-1',
			fulfilled: true,
			evidence: 'Document was sent and confirmed',
			confidence: 0.95,
		});
		expect(result.traceId).toBe('00000000-0000-0000-0000-000000000001');
		expect(result.variant).toBe('detection_default');
	});

	it('uses low temperature for classification', async () => {
		createSpy.mockClear();

		await detectFulfillment(commitments, messages, salt);

		const callArgs = createSpy.mock.calls[0][0];
		expect(callArgs.temperature).toBe(0.1);
	});
});
