import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferWithCache = vi.hoisted(() => vi.fn());

vi.mock('../cached-inference', () => ({
	inferWithCache: mockInferWithCache,
}));

const fetchMock = vi.fn();

function enableLocalQwenIntroductions() {
	vi.stubEnv('NODE_ENV', 'development');
	vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
	vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'local');
	vi.stubEnv('COMMITMENT_LLM_BASE_URL', 'http://localhost:11434/v1');
	vi.stubEnv('COMMITMENT_LLM_MODEL', 'qwen3:4b-instruct');
}

describe('local Qwen introduction detection', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					message: {
						content: JSON.stringify({
							introductions: [
								{
									introducer_ref: 'PERSON_alice',
									introduced_ref_1: 'PERSON_bob',
									introduced_ref_2: 'PERSON_carol',
									context: 'knowledge',
									confidence: 0.88,
									reasoning: 'PERSON_alice explicitly introduced PERSON_bob and PERSON_carol.',
									source_message_ids: [
										'11111111-1111-4111-8111-111111111111',
										'not-from-transcript',
									],
								},
								{
									introducer_ref: 'Alice',
									introduced_ref_1: 'PERSON_bob',
									introduced_ref_2: 'PERSON_carol',
									context: 'deal',
									confidence: 0.9,
									reasoning: 'Invalid raw-name ref should be rejected.',
									source_message_ids: ['11111111-1111-4111-8111-111111111111'],
								},
							],
						}),
					},
				}),
			text: () => Promise.resolve(''),
		});
	});

	it('routes introduction detection to local Qwen and filters ungrounded model output', async () => {
		enableLocalQwenIntroductions();
		const { detectIntroductions } = await import('../introduction-detection');

		const result = await detectIntroductions(
			[
				'[source:11111111-1111-4111-8111-111111111111] [speaker:PERSON_alice] [assistant] I want PERSON_bob to meet PERSON_carol.',
				'[source:22222222-2222-4222-8222-222222222222] [speaker:PERSON_bob] [assistant] Great.',
			].join('\n'),
		);

		expect(mockInferWithCache).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:11434/api/chat',
			expect.objectContaining({
				headers: expect.not.objectContaining({
					Authorization: expect.any(String),
				}),
			}),
		);
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
			model: string;
			messages: Array<{ role: string; content: string }>;
			format: { type: string; properties: Record<string, unknown> };
			options: { num_predict: number; temperature: number };
			stream: boolean;
			think: boolean;
		};
		expect(body.model).toBe('qwen3:4b-instruct');
		expect(body.format.properties).toHaveProperty('introductions');
		expect(body.stream).toBe(false);
		expect(body.think).toBe(false);
		expect(body.messages[0].content).toContain('[speaker:PERSON_*]');

		expect(result).toEqual([
			expect.objectContaining({
				introducer_ref: 'PERSON_alice',
				introduced_ref_1: 'PERSON_bob',
				introduced_ref_2: 'PERSON_carol',
				context: 'knowledge',
				confidence: 0.88,
				source_message_ids: ['11111111-1111-4111-8111-111111111111'],
			}),
		]);
	});
});
