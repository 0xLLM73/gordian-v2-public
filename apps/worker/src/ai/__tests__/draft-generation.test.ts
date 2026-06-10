import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSelectPromptVariant = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../bandit', () => ({
	selectPromptVariant: mockSelectPromptVariant,
}));

function enableLocalQwenDrafts() {
	vi.stubEnv('CHAT_LLM_PROVIDER', 'local');
	vi.stubEnv('CHAT_LLM_BASE_URL', 'http://localhost:11434/v1');
	vi.stubEnv('CHAT_LLM_MODEL', 'qwen3.5:9b');
}

function localDraftResponse(text: string) {
	return {
		ok: true,
		json: () =>
			Promise.resolve({
				message: {
					content: text,
				},
			}),
		text: () => Promise.resolve(''),
	};
}

describe('follow-up draft generation', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
		vi.stubGlobal('fetch', fetchMock);
		vi.clearAllMocks();
		mockSelectPromptVariant.mockResolvedValue({
			variant: 'casual_nudge',
			traceId: 'trace-1',
		});
	});

	it('generates drafts through the local chat runtime', async () => {
		enableLocalQwenDrafts();
		fetchMock.mockResolvedValueOnce(
			localDraftResponse('<think>private reasoning</think>\nHey, good catching up yesterday.'),
		);

		const { generateDraft } = await import('../draft-generation');
		const result = await generateDraft(
			'Contact: PERSON_masked\nDiscussed local AI setup.',
			'Follow-up Plan: VC Follow-up\nInstructions: Thank them for meeting',
			'casual_nudge',
		);

		expect(result).toBe('Hey, good catching up yesterday.');
		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:11434/api/chat',
			expect.objectContaining({
				method: 'POST',
				headers: expect.not.objectContaining({
					Authorization: expect.any(String),
				}),
			}),
		);
		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
			model: string;
			messages: Array<{ role: string; content: string }>;
			stream: boolean;
			think: boolean;
			options: { temperature: number; num_predict: number };
		};
		expect(body.model).toBe('qwen3.5:9b');
		expect(body.stream).toBe(false);
		expect(body.think).toBe(false);
		expect(body.options.temperature).toBe(0.7);
		expect(body.options.num_predict).toBe(512);
		expect(body.messages[0]).toEqual(
			expect.objectContaining({
				role: 'system',
				content: expect.stringContaining('You are a message drafting assistant'),
			}),
		);
		expect(body.messages[1]).toEqual(
			expect.objectContaining({
				role: 'user',
				content: expect.stringContaining('Contact Summary:'),
			}),
		);
	});

	it('selects a bandit arm before local draft generation', async () => {
		enableLocalQwenDrafts();
		fetchMock.mockResolvedValueOnce(localDraftResponse('Local draft text'));

		const { generateDraftWithBandit } = await import('../draft-generation');
		const result = await generateDraftWithBandit('Summary', 'Context', 'owner-1');

		expect(mockSelectPromptVariant).toHaveBeenCalledWith(
			'draft_generation',
			expect.arrayContaining(['casual_nudge', 'professional_value', 'direct_ask', 'soft_memory']),
			'owner-1',
		);
		expect(result).toEqual({
			text: 'Local draft text',
			armType: 'casual_nudge',
			traceId: 'trace-1',
		});
	});

	it('fails closed when local follow-up draft AI is not configured', async () => {
		const { generateDraft } = await import('../draft-generation');
		await expect(generateDraft('Summary', 'Context', 'casual_nudge')).rejects.toThrow(
			'Local follow-up draft AI is not configured',
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
