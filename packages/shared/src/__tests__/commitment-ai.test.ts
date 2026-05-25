import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_COMMITMENT_LLM_MODEL, getCommitmentLlmRuntime } from '../commitment-ai';

describe('commitment AI runtime config', () => {
	it('defaults to the existing cloud commitment extraction path', () => {
		expect(getCommitmentLlmRuntime({})).toEqual({
			provider: 'cloud',
			mode: 'cloud',
			label: 'Claude cloud commitment extraction',
		});
	});

	it('configures local Qwen through native Ollama chat by default', () => {
		expect(
			getCommitmentLlmRuntime({
				COMMITMENT_LLM_PROVIDER: 'local',
				COMMITMENT_LLM_BASE_URL: 'http://localhost:11434/v1/',
				COMMITMENT_LLM_MODEL: 'qwen3:4b-instruct',
			}),
		).toMatchObject({
			provider: 'local',
			mode: 'local',
			api: 'ollama',
			baseUrl: 'http://localhost:11434/v1',
			ollamaChatUrl: 'http://localhost:11434/api/chat',
			model: 'qwen3:4b-instruct',
			label: 'Qwen local commitment extraction',
		});
	});

	it('supports explicit OpenAI-compatible local chat endpoints', () => {
		expect(
			getCommitmentLlmRuntime({
				COMMITMENT_LLM_PROVIDER: 'local',
				COMMITMENT_LLM_API: 'openai-compatible',
				COMMITMENT_LLM_BASE_URL: 'http://localhost:1234/v1/',
				COMMITMENT_LLM_MODEL: 'local-chat',
			}),
		).toMatchObject({
			provider: 'local',
			mode: 'local',
			api: 'openai-compatible',
			baseUrl: 'http://localhost:1234/v1',
			chatCompletionsUrl: 'http://localhost:1234/v1/chat/completions',
			model: 'local-chat',
		});
	});

	it('uses Qwen as the default local commitment model', () => {
		expect(
			getCommitmentLlmRuntime({
				COMMITMENT_LLM_PROVIDER: 'local',
			}).model,
		).toBe(DEFAULT_LOCAL_COMMITMENT_LLM_MODEL);
	});

	it('rejects remote URLs configured as local commitment endpoints unless explicitly allowed', () => {
		expect(() =>
			getCommitmentLlmRuntime({
				COMMITMENT_LLM_PROVIDER: 'local',
				COMMITMENT_LLM_BASE_URL: 'https://models.example.com/v1',
			}),
		).toThrow(/local AI endpoint/);
		expect(() =>
			getCommitmentLlmRuntime({
				ALLOW_NONLOCAL_AI_ENDPOINTS: 'true',
				COMMITMENT_LLM_PROVIDER: 'local',
				COMMITMENT_LLM_BASE_URL: 'https://models.example.com/v1',
			}),
		).not.toThrow();
	});
});
