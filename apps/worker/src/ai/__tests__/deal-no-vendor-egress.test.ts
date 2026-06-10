import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDealContextPack, generateDealBriefLocal } from '../deal-intelligence';

const fetchMock = vi.hoisted(() => vi.fn());

describe('deal local AI vendor egress guard', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});

	it('does not call vendors when cloud keys exist but local deal AI is not configured', async () => {
		vi.stubEnv('OPENAI_API_KEY', 'sk-test');
		vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
		vi.stubEnv('GEMINI_API_KEY', 'gemini-test');
		vi.stubEnv('CHAT_LLM_PROVIDER', 'cloud');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');

		const context = buildDealContextPack({
			workspaceId: 'workspace-a',
			deal: {
				id: 'deal-a',
				workspaceId: 'workspace-a',
				title: 'Aptos Series A',
				stage: 'discovery',
				value: 100_000_00,
			},
		});

		const result = await generateDealBriefLocal(context);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.usedModel).toBe(false);
		expect(result.modelRole).toBe('deterministic_fallback');
		expect(result.localVendorMode).toBe('deterministic_fallback');
		expect(result.uncertainty).toContain('no linked source evidence');
	});
});
