import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDealContextPack, generateDealBriefLocal } from '../deal-intelligence';

const fetchMock = vi.hoisted(() => vi.fn());

function context() {
	return buildDealContextPack({
		workspaceId: 'workspace-a',
		deal: {
			id: 'deal-a',
			workspaceId: 'workspace-a',
			title: 'Aptos Series A',
			stage: 'diligence',
			value: 2_000_000_00,
		},
		evidenceLinks: [
			{
				id: 'evidence-1',
				workspaceId: 'workspace-a',
				dealId: 'deal-a',
				sourceType: 'manual_note',
				label: 'Call note',
				summary: 'Founder confirmed diligence materials are ready.',
			},
		],
	});
}

describe('local deal brief generation', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});

	it('uses the local Qwen chat runtime and source manifest', async () => {
		vi.stubEnv('CHAT_LLM_PROVIDER', 'local');
		vi.stubEnv('CHAT_LLM_API', 'ollama');
		vi.stubEnv('CHAT_LLM_BASE_URL', 'http://localhost:11434');
		vi.stubEnv('CHAT_LLM_MODEL', 'qwen3.5:9b');
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					message: {
						content: JSON.stringify({
							output: 'Local Qwen brief: diligence is supported by the call note.',
							uncertainty: 'Low uncertainty with one linked source.',
						}),
					},
				}),
			text: () => Promise.resolve(''),
		});

		const result = await generateDealBriefLocal(context());

		expect(result.output).toContain('Local Qwen brief');
		expect(result.modelRole).toBe('local_chat');
		expect(result.modelName).toBe('qwen3.5:9b');
		expect(result.usedModel).toBe(true);
		expect(result.sourceManifest).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:11434/api/chat',
			expect.objectContaining({ method: 'POST' }),
		);
		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
			model: string;
			stream: boolean;
			think: boolean;
			messages: Array<{ content: string }>;
		};
		expect(body.model).toBe('qwen3.5:9b');
		expect(body.stream).toBe(false);
		expect(body.think).toBe(false);
		expect(body.messages[1].content).toContain('sourceManifest');
	});
});
