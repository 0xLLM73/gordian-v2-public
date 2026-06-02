import { describe, expect, it } from 'vitest';
import { getChatLlmRuntime, getDigestLlmRuntime } from '../chat-ai';

describe('chat AI runtime config', () => {
	it('defaults to cloud chat when no local chat config exists', () => {
		expect(getChatLlmRuntime({})).toMatchObject({
			mode: 'cloud',
			provider: 'cloud',
			source: 'default',
		});
	});

	it('uses explicit CHAT_LLM local config before commitment fallback', () => {
		const runtime = getChatLlmRuntime({
			CHAT_LLM_PROVIDER: 'local',
			CHAT_LLM_API: 'ollama',
			CHAT_LLM_BASE_URL: 'http://localhost:11434',
			CHAT_LLM_MODEL: 'qwen3.5:9b',
			COMMITMENT_LLM_PROVIDER: 'local',
			COMMITMENT_LLM_MODEL: 'qwen3.5:2b',
		});

		expect(runtime).toMatchObject({
			mode: 'local',
			api: 'ollama',
			model: 'qwen3.5:9b',
			ollamaChatUrl: 'http://localhost:11434/api/chat',
			label: 'Qwen local chat',
			source: 'chat',
		});
	});

	it('preserves local chat behavior by falling back to commitment Qwen config', () => {
		const runtime = getChatLlmRuntime({
			COMMITMENT_LLM_PROVIDER: 'local',
			COMMITMENT_LLM_API: 'ollama',
			COMMITMENT_LLM_BASE_URL: 'http://localhost:11434',
			COMMITMENT_LLM_MODEL: 'qwen3.5:9b',
		});

		expect(runtime).toMatchObject({
			mode: 'local',
			api: 'ollama',
			model: 'qwen3.5:9b',
			ollamaChatUrl: 'http://localhost:11434/api/chat',
			source: 'commitment-fallback',
		});
	});

	it('rejects remote explicit CHAT_LLM local endpoints unless allowed', () => {
		expect(() =>
			getChatLlmRuntime({
				CHAT_LLM_PROVIDER: 'local',
				CHAT_LLM_BASE_URL: 'https://models.example.com/v1',
			}),
		).toThrow(/local AI endpoint/);
	});

	it('uses explicit DIGEST_LLM local config before chat fallback', () => {
		const runtime = getDigestLlmRuntime({
			DIGEST_LLM_PROVIDER: 'local',
			DIGEST_LLM_API: 'ollama',
			DIGEST_LLM_BASE_URL: 'http://localhost:11434',
			DIGEST_LLM_MODEL: 'qwen3.5:9b',
			CHAT_LLM_PROVIDER: 'local',
			CHAT_LLM_MODEL: 'qwen3.5:2b',
		});

		expect(runtime).toMatchObject({
			mode: 'local',
			api: 'ollama',
			model: 'qwen3.5:9b',
			ollamaChatUrl: 'http://localhost:11434/api/chat',
			label: 'Qwen local digest',
			source: 'digest',
		});
	});

	it('falls digest generation back to local chat config', () => {
		const runtime = getDigestLlmRuntime({
			CHAT_LLM_PROVIDER: 'local',
			CHAT_LLM_API: 'ollama',
			CHAT_LLM_BASE_URL: 'http://localhost:11434',
			CHAT_LLM_MODEL: 'qwen3.5:9b',
		});

		expect(runtime).toMatchObject({
			mode: 'local',
			model: 'qwen3.5:9b',
			label: 'Qwen local digest',
			source: 'chat-fallback',
		});
	});

	it('falls digest generation back through commitment Qwen when chat is unset', () => {
		const runtime = getDigestLlmRuntime({
			COMMITMENT_LLM_PROVIDER: 'local',
			COMMITMENT_LLM_API: 'ollama',
			COMMITMENT_LLM_BASE_URL: 'http://localhost:11434',
			COMMITMENT_LLM_MODEL: 'qwen3.5:9b',
		});

		expect(runtime).toMatchObject({
			mode: 'local',
			model: 'qwen3.5:9b',
			source: 'commitment-fallback',
		});
	});
});
