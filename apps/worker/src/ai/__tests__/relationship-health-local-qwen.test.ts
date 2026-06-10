import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

function enableLocalQwenRelationshipHealth() {
	vi.stubEnv('NODE_ENV', 'development');
	vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
	vi.stubEnv('COMMITMENT_LLM_PROVIDER', 'local');
	vi.stubEnv('COMMITMENT_LLM_BASE_URL', 'http://localhost:11434/v1');
	vi.stubEnv('COMMITMENT_LLM_MODEL', 'qwen3:4b-instruct');
}

describe('local Qwen relationship health classifier', () => {
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
							meaningful_exchange: { label: 'meaningful', confidence: 0.84 },
							direct_ask: { detected: true, user_owes_reply: true, confidence: 0.91 },
							topic_labels: ['work', 'planning', 'exact_private_project_name'],
							draft_check_in: { available: true },
						}),
					},
				}),
			text: () => Promise.resolve(''),
		});
	});

	it('routes relationship health analysis to local Qwen and returns bounded signals', async () => {
		enableLocalQwenRelationshipHealth();
		const { analyzeRelationshipHealthLocal, canRunLocalRelationshipHealthAnalysis } = await import(
			'../relationship-health'
		);

		expect(canRunLocalRelationshipHealthAnalysis()).toBe(true);

		const result = await analyzeRelationshipHealthLocal([
			{
				content: 'Can you send the private launch deck for the thing?',
				isOutgoing: false,
				sentAt: new Date('2026-06-08T10:00:00.000Z'),
			},
			{
				content: 'I will take a look.',
				isOutgoing: true,
				sentAt: new Date('2026-06-08T10:03:00.000Z'),
			},
		]);

		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:11434/api/chat',
			expect.objectContaining({
				headers: expect.not.objectContaining({
					Authorization: expect.any(String),
				}),
			}),
		);
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
			format: { type: string; properties: Record<string, unknown> };
			model: string;
			stream: boolean;
			think: boolean;
		};
		expect(body.model).toBe('qwen3:4b-instruct');
		expect(body.stream).toBe(false);
		expect(body.think).toBe(false);
		expect(body.format.properties).toHaveProperty('meaningful_exchange');
		expect(body.format.properties).toHaveProperty('direct_ask');

		expect(result).toEqual({
			version: 1,
			meaningfulExchange: { label: 'meaningful', confidence: 0.84 },
			directAsk: { detected: true, userOwesReply: true, confidence: 0.91 },
			topicLabels: ['work', 'planning'],
			draftCheckIn: { available: true, reviewRequired: true, autoSend: false },
			runtime: { mode: 'local', model: 'qwen3:4b-instruct', source: 'commitment-fallback' },
		});
	});

	it('falls back when classifier confidence is too low', async () => {
		enableLocalQwenRelationshipHealth();
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					message: {
						content: JSON.stringify({
							meaningful_exchange: { label: 'unclear', confidence: 0.2 },
							direct_ask: { detected: false, user_owes_reply: false, confidence: 0.1 },
							topic_labels: ['other'],
							draft_check_in: { available: false },
						}),
					},
				}),
			text: () => Promise.resolve(''),
		});
		const { analyzeRelationshipHealthLocal } = await import('../relationship-health');

		await expect(
			analyzeRelationshipHealthLocal([
				{
					content: 'ok',
					isOutgoing: false,
					sentAt: new Date('2026-06-08T10:00:00.000Z'),
				},
			]),
		).resolves.toBeUndefined();
	});
});
