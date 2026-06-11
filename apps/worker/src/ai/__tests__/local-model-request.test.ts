import { describe, expect, it, vi } from 'vitest';
import {
	fetchLocalModel,
	localAiRequestTimeoutMs,
	localOllamaKeepAlive,
	withOllamaKeepAlive,
} from '../local-model-request';

describe('local model request controls', () => {
	it('uses resource-friendly defaults for local model requests', () => {
		expect(localAiRequestTimeoutMs({} as NodeJS.ProcessEnv)).toBe(120_000);
		expect(localOllamaKeepAlive({} as NodeJS.ProcessEnv)).toBe('1m');
		expect(withOllamaKeepAlive({ model: 'qwen3.5:9b' }, {} as NodeJS.ProcessEnv)).toEqual({
			model: 'qwen3.5:9b',
			keep_alive: '1m',
		});
	});

	it('allows callers to use the Ollama server default keep_alive', () => {
		const env = { LOCAL_AI_OLLAMA_KEEP_ALIVE: 'default' } as NodeJS.ProcessEnv;
		expect(localOllamaKeepAlive(env)).toBeUndefined();
		expect(withOllamaKeepAlive({ model: 'qwen3.5:9b' }, env)).toEqual({
			model: 'qwen3.5:9b',
		});
	});

	it('aborts local model requests that exceed the timeout', async () => {
		const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			fetchLocalModel(
				'http://localhost:11434/api/chat',
				{ method: 'POST' },
				{
					label: 'Local test model',
					timeoutMs: 1,
				},
			),
		).rejects.toThrow('Local test model timed out after 0s');
		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:11434/api/chat',
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		vi.unstubAllGlobals();
	});
});
