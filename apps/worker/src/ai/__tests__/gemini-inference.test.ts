import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateContent = vi.hoisted(() => vi.fn());
const mockGetGenerativeModel = vi.hoisted(() => vi.fn());
const mockGoogleGenerativeAI = vi.hoisted(() => vi.fn());

vi.mock('@google/generative-ai', () => ({
	GoogleGenerativeAI: mockGoogleGenerativeAI,
}));

describe('Gemini inference privacy gate', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent });
		mockGoogleGenerativeAI.mockReturnValue({ getGenerativeModel: mockGetGenerativeModel });
		mockGenerateContent.mockResolvedValue({
			response: { text: () => 'gemini response' },
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('fails closed outside tests when AI processing is not explicitly enabled', async () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'false');
		vi.stubEnv('GEMINI_API_KEY', 'gemini-key');
		const { inferWithGemini } = await import('../gemini-inference');

		await expect(
			inferWithGemini({ systemPrompt: 'system', userPrompt: 'masked user prompt' }),
		).rejects.toThrow(/AI_PROCESSING_ENABLED=true/);
		expect(mockGoogleGenerativeAI).not.toHaveBeenCalled();
		expect(mockGenerateContent).not.toHaveBeenCalled();
	});

	it('calls Gemini only after explicit AI processing opt-in', async () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('AI_PROCESSING_ENABLED', 'true');
		vi.stubEnv('GEMINI_API_KEY', 'gemini-key');
		const { inferWithGemini } = await import('../gemini-inference');

		await expect(
			inferWithGemini({ systemPrompt: 'system', userPrompt: 'masked user prompt' }),
		).resolves.toBe('gemini response');

		expect(mockGoogleGenerativeAI).toHaveBeenCalledWith('gemini-key');
		expect(mockGenerateContent).toHaveBeenCalledWith({
			systemInstruction: 'system',
			contents: [{ role: 'user', parts: [{ text: 'masked user prompt' }] }],
		});
	});
});
