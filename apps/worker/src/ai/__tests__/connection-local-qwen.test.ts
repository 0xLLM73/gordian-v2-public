import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInferWithCache = vi.hoisted(() => vi.fn());

vi.mock('../cached-inference', () => ({
	inferWithCache: mockInferWithCache,
}));

const fetchMock = vi.fn();

function enableLocalQwenConnections() {
	vi.stubEnv('NODE_ENV', 'development');
	vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
	vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'local');
	vi.stubEnv('COMMITMENT_LLM_BASE_URL', 'http://localhost:11434/v1');
	vi.stubEnv('COMMITMENT_LLM_MODEL', 'qwen3:4b-instruct');
}

describe('local Qwen connection detection', () => {
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
							connections: [
								{
									contact_name: 'PERSON_alice',
									event: 'ETHDenver',
									context: 'First met at ETHDenver.',
									confidence: 0.91,
									reasoning: 'Explicit great-to-meet-you signal.',
									source_message_ids: [
										'11111111-1111-4111-8111-111111111111',
										'not-from-transcript',
									],
								},
							],
						}),
					},
				}),
			text: () => Promise.resolve(''),
		});
	});

	it('routes connection detection to local Qwen and filters invalid source IDs', async () => {
		enableLocalQwenConnections();
		const { detectConnections } = await import('../connection-detection');

		const result = await detectConnections(
			[
				'[source:11111111-1111-4111-8111-111111111111] [speaker:PERSON_alice] [assistant] Great to meet you at ETHDenver.',
				'[source:22222222-2222-4222-8222-222222222222] [speaker:PERSON_alice] [assistant] Talk soon.',
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
			format: { type: string; properties: Record<string, unknown> };
			stream: boolean;
			think: boolean;
		};
		expect(body.model).toBe('qwen3:4b-instruct');
		expect(body.format.properties).toHaveProperty('connections');
		expect(body.stream).toBe(false);
		expect(body.think).toBe(false);

		expect(result).toEqual([
			expect.objectContaining({
				contact_name: 'PERSON_alice',
				event: 'ETHDenver',
				context: 'First met at ETHDenver.',
				confidence: 0.91,
				source_message_ids: ['11111111-1111-4111-8111-111111111111'],
			}),
		]);
	});
});
